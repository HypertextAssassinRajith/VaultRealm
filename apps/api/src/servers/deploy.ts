/**
 * Deploy Engine — 9-step tracked state machine for server deployment.
 *
 * Implements §8 of IMPLEMENTATION_PLAN.md:
 * 1. Validate
 * 2. Quota check (user + host guard)
 * 3. Allocate ports
 * 4. Prepare volume
 * 5. Pull image (streamed progress)
 * 6. Create container (hardened limits)
 * 7. Start container
 * 8. Verify
 * 9. Done
 *
 * Every step writes to the `events` table. Failures are never silent.
 */

import { EventEmitter } from 'events';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDatabase } from '../db/index.js';
import { servers, serverPorts, events } from '../db/schema.js';
import { getTemplate } from './templates.js';
import { allocatePorts } from './ports.js';
import { assertQuotaAvailable } from './quota.js';
import { prepareServerVolume } from './volume.js';
import { getDockerDriver } from './service.js';
import { writeAudit } from '../audit/log.js';
import type { AuthUser } from '../auth/rbac.js';

export interface DeployStepEvent {
  serverId: string;
  step: number;
  stepName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
  percent?: number;
  error?: string;
  timestamp: string;
}

export type DeployProgressListener = (event: DeployStepEvent) => void;

class DeployEventBus extends EventEmitter {}
const deployBus = new DeployEventBus();

/**
 * Subscribe to deploy progress events for a server.
 * Returns an unsubscribe function.
 */
export function subscribeDeployProgress(serverId: string, listener: DeployProgressListener): () => void {
  const handler = (evt: DeployStepEvent) => {
    if (evt.serverId === serverId) {
      listener(evt);
    }
  };
  deployBus.on('progress', handler);
  return () => deployBus.off('progress', handler);
}

function emitDeployStep(
  serverId: string,
  step: number,
  stepName: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
  message: string,
  percent?: number,
  error?: string,
): void {
  const evt: DeployStepEvent = {
    serverId,
    step,
    stepName,
    status,
    message,
    percent,
    error,
    timestamp: new Date().toISOString(),
  };

  // Write to DB events table for persistence & debug timeline
  try {
    const db = getDatabase();
    db.insert(events)
      .values({
        id: nanoid(),
        serverId,
        kind: `deploy.${stepName}.${status}`,
        message,
        dataJson: JSON.stringify({ step, stepName, status, percent, error }),
      })
      .run();
  } catch (err) {
    console.error(`[deploy] Failed to write event for server ${serverId}:`, err);
  }

  deployBus.emit('progress', evt);
}

export interface DeployServerOptions {
  name: string;
  templateId: string;
  ramMb?: number;
  cpuLimit?: number;
  diskLimitMb?: number;
  env?: Record<string, string>;
  ip?: string;
}

/**
 * Executes the 9-step deployment pipeline.
 */
export async function executeDeploy(
  user: AuthUser,
  input: DeployServerOptions,
): Promise<{ serverId: string; name: string; status: string }> {
  const db = getDatabase();

  // ── Step 1: Validate ───────────────────────────────────────────────────────
  const template = getTemplate(input.templateId);
  if (!template) {
    const err = new Error(`Unknown game template: "${input.templateId}"`);
    (err as Error & { statusCode: number; code: string }).statusCode = 400;
    (err as Error & { statusCode: number; code: string }).code = 'INVALID_TEMPLATE';
    throw err;
  }

  // Name uniqueness per owner
  const existingName = db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.ownerId, user.id), eq(servers.name, input.name)))
    .all();

  if (existingName.length > 0) {
    const err = new Error(`You already have a server named "${input.name}". Choose a unique name.`);
    (err as Error & { statusCode: number; code: string }).statusCode = 409;
    (err as Error & { statusCode: number; code: string }).code = 'DUPLICATE_NAME';
    throw err;
  }

  const ramMb = input.ramMb ?? template.defaultRamMb;
  if (ramMb < template.minRamMb) {
    const err = new Error(
      `Minimum RAM for ${template.name} is ${template.minRamMb} MB (requested ${ramMb} MB).`,
    );
    (err as Error & { statusCode: number; code: string }).statusCode = 400;
    (err as Error & { statusCode: number; code: string }).code = 'INVALID_RESOURCES';
    throw err;
  }

  const cpuLimit = input.cpuLimit ?? template.defaultCpu;
  const diskLimitMb = input.diskLimitMb ?? template.defaultDiskMb;

  // ── Step 2: Quota check ────────────────────────────────────────────────────
  assertQuotaAvailable(user.id, ramMb, cpuLimit, diskLimitMb);

  // ── Step 3: Allocate ports ─────────────────────────────────────────────────
  const hostPorts = allocatePorts(template.ports.length);

  // Create initial DB record in "creating" state
  const serverId = nanoid();
  const envMap: Record<string, string> = {
    ...Object.fromEntries(
      template.env
        .filter((e) => e.default !== undefined)
        .map((e) => [e.key, e.default!]),
    ),
    ...(input.env ?? {}),
  };

  // Auto-set memory for Minecraft
  if (template.id.startsWith('minecraft') && !envMap.MEMORY) {
    envMap.MEMORY = `${ramMb}M`;
  }

  // Generate RCON password if missing
  if (template.rcon && !envMap[template.rcon.passwordEnv]) {
    envMap[template.rcon.passwordEnv] = nanoid(16);
  }

  db.insert(servers)
    .values({
      id: serverId,
      ownerId: user.id,
      name: input.name,
      templateId: template.id,
      ramMb,
      cpuLimit,
      diskLimitMb,
      envJson: JSON.stringify(envMap),
      status: 'creating',
    })
    .run();

  for (let i = 0; i < template.ports.length; i++) {
    const tp = template.ports[i]!;
    db.insert(serverPorts)
      .values({
        id: nanoid(),
        serverId,
        name: tp.name,
        hostPort: hostPorts[i]!,
        containerPort: tp.containerPort,
        protocol: tp.protocol,
      })
      .run();
  }

  emitDeployStep(serverId, 1, 'validate', 'completed', 'Template and parameters validated.');
  emitDeployStep(serverId, 2, 'quota', 'completed', 'User quota and host RAM limits verified.');
  emitDeployStep(
    serverId,
    3,
    'ports',
    'completed',
    `Ports allocated: ${hostPorts.join(', ')}.`,
  );

  writeAudit({
    userId: user.id,
    action: 'server.create',
    target: serverId,
    ip: input.ip,
    data: { name: input.name, templateId: template.id, ramMb },
  });

  // Run the remaining deployment steps asynchronously in background
  // while streaming progress to SSE listeners
  runAsyncDeploy(serverId, user.id, template, envMap).catch((err) => {
    console.error(`[deploy] Async deployment failed for ${serverId}:`, err);
  });

  return { serverId, name: input.name, status: 'creating' };
}

async function runAsyncDeploy(
  serverId: string,
  userId: string,
  template: ReturnType<typeof getTemplate> & object,
  envMap: Record<string, string>,
): Promise<void> {
  const db = getDatabase();
  const driver = getDockerDriver();

  let containerId: string | null = null;

  try {
    // ── Step 4: Prepare volume ───────────────────────────────────────────────
    emitDeployStep(serverId, 4, 'volume', 'running', 'Preparing host storage directory...');
    const serverDir = await prepareServerVolume(serverId, template);
    emitDeployStep(serverId, 4, 'volume', 'completed', `Storage volume ready at ${serverDir}`);

    // ── Step 5: Pull image ───────────────────────────────────────────────────
    emitDeployStep(serverId, 5, 'pull', 'running', `Checking image ${template.image}...`, 0);
    const hasImg = await driver.hasImage(template.image);
    if (!hasImg) {
      emitDeployStep(serverId, 5, 'pull', 'running', `Pulling ${template.image}...`, 10);
      await driver.pullImage(template.image, (progress) => {
        if (progress.progressPercent !== undefined) {
          emitDeployStep(
            serverId,
            5,
            'pull',
            'running',
            `Pulling ${template.image}: ${progress.progressPercent}%`,
            progress.progressPercent,
          );
        }
      });
    }
    emitDeployStep(serverId, 5, 'pull', 'completed', `Image ${template.image} is ready.`, 100);

    // ── Step 6: Create container ─────────────────────────────────────────────
    emitDeployStep(serverId, 6, 'create', 'running', 'Creating Docker container with resource limits...');
    db.update(servers).set({ status: 'starting' }).where(eq(servers.id, serverId)).run();

    const ports = db.select().from(serverPorts).where(eq(serverPorts.serverId, serverId)).all();

    containerId = await driver.createContainer({
      name: `vr-${serverId}`,
      image: template.image,
      env: envMap,
      labels: {
        'gamepanel.server': serverId,
        'vaultrealm.server': serverId,
        'vaultrealm.template': template.id,
        'vaultrealm.owner': userId,
      },
      ports: ports.map((p) => ({
        hostPort: p.hostPort,
        containerPort: p.containerPort,
        protocol: p.protocol as 'tcp' | 'udp',
      })),
      volumes: [
        {
          hostPath: serverDir,
          containerPath: template.dataDir,
          readOnly: false,
        },
      ],
      memoryMb: template.defaultRamMb,
      cpuLimit: template.defaultCpu,
      pidsLimit: 512,
      restartPolicy: 'no', // 'unless-stopped' only after first successful start (§8)
      securityOpt: ['no-new-privileges:true'],
      logDriver: 'json-file',
      logOpts: { 'max-size': '20m', 'max-file': '3' },
    });

    db.update(servers).set({ containerId }).where(eq(servers.id, serverId)).run();
    emitDeployStep(serverId, 6, 'create', 'completed', `Container created (${containerId.slice(0, 12)}).`);

    // ── Step 7: Start container ──────────────────────────────────────────────
    emitDeployStep(serverId, 7, 'start', 'running', 'Starting container...');
    await driver.startContainer(containerId);
    emitDeployStep(serverId, 7, 'start', 'completed', 'Container started.');

    // ── Step 8: Verify container ─────────────────────────────────────────────
    emitDeployStep(serverId, 8, 'verify', 'running', 'Verifying container running state...');
    const inspect = await driver.inspectContainer(containerId);
    if (!inspect.state.running) {
      throw new Error(`Container exited immediately with code ${inspect.state.exitCode}: ${inspect.state.error || 'Unknown failure'}`);
    }
    emitDeployStep(serverId, 8, 'verify', 'completed', 'Container verified running.');

    // ── Step 9: Done ─────────────────────────────────────────────────────────
    db.update(servers)
      .set({
        status: 'running',
        lastStartedAt: new Date().toISOString(),
      })
      .where(eq(servers.id, serverId))
      .run();

    emitDeployStep(serverId, 9, 'done', 'completed', 'Server deployed and running successfully!');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[deploy] Error in deploy step for server ${serverId}:`, err);

    // According to §8 step 9: on any failure, keep container and logs for inspection (don't auto-delete!)
    // mark status as 'error'
    db.update(servers)
      .set({ status: 'error' })
      .where(eq(servers.id, serverId))
      .run();

    emitDeployStep(
      serverId,
      9,
      'error',
      'failed',
      `Deployment failed: ${errorMsg}`,
      undefined,
      errorMsg,
    );
  }
}
