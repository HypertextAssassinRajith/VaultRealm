/**
 * Diagnosis Engine — Evaluates rules and saves findings.
 *
 * Implements §9.3 of IMPLEMENTATION_PLAN.md.
 */

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDatabase } from '../db/index.js';
import { servers, events, diagnoses } from '../db/schema.js';
import { getDockerDriver } from '../servers/service.js';
import { getTemplate } from '../servers/templates.js';
import { getHostCapacityStatus } from '../servers/quota.js';
import { allocatePorts } from '../servers/ports.js';
import { prepareServerVolume } from '../servers/volume.js';
import { restartServer } from '../servers/service.js';
import type { DiagnosisRule, DiagnosisContext, Finding, FixAction } from './types.js';

import { oomKilledRule } from './rules/oom-killed.js';
import { portInUseRule } from './rules/port-in-use.js';
import { eulaNotAcceptedRule } from './rules/eula-not-accepted.js';
import { javaVersionRule } from './rules/java-version.js';
import { permissionDeniedRule } from './rules/permission-denied.js';
import { diskFullRule } from './rules/disk-full.js';
import { crashLoopRule } from './rules/crash-loop.js';
import { noReadySignalRule } from './rules/no-ready-signal.js';
import { unknownExitRule } from './rules/unknown-exit.js';

export const BUILTIN_RULES: DiagnosisRule[] = [
  oomKilledRule,
  portInUseRule,
  eulaNotAcceptedRule,
  javaVersionRule,
  permissionDeniedRule,
  diskFullRule,
  crashLoopRule,
  noReadySignalRule,
  unknownExitRule,
];

/**
 * Runs all registered rules against a given diagnosis context.
 */
export function evaluateRules(
  ctx: DiagnosisContext,
  rules: DiagnosisRule[] = BUILTIN_RULES,
): Finding[] {
  const findings: Finding[] = [];

  for (const rule of rules) {
    try {
      const finding = rule.match(ctx);
      if (finding) {
        findings.push(finding);
      }
    } catch (err) {
      console.error(`[diagnosis] Error evaluating rule ${rule.id}:`, err);
    }
  }

  // Sort: error first, then warn, then info
  const severityOrder = { error: 0, warn: 1, info: 2 };
  return findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

/**
 * Automatically inspects a server and runs diagnosis.
 * Saves findings to the `diagnoses` table.
 */
export async function diagnoseServer(serverId: string): Promise<Finding[]> {
  const db = getDatabase();
  const driver = getDockerDriver();

  const server = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const template = getTemplate(server.templateId);
  const host = getHostCapacityStatus();

  let logs: string[] = [];
  let inspect = null;

  if (server.containerId) {
    try {
      inspect = await driver.inspectContainer(server.containerId);
    } catch {
      // container might be missing
    }
    try {
      logs = await driver.getContainerLogs(server.containerId, 500);
    } catch {
      // container might have no logs
    }
  }

  const recentEvents = db
    .select({
      kind: events.kind,
      message: events.message,
      ts: events.ts,
      dataJson: events.dataJson,
    })
    .from(events)
    .where(eq(events.serverId, serverId))
    .limit(50)
    .all();

  const ctx: DiagnosisContext = {
    serverId,
    logs,
    inspect,
    events: recentEvents,
    template,
    host,
  };

  const findings = evaluateRules(ctx);

  // Clear previous diagnoses for this server and insert new findings
  db.delete(diagnoses).where(eq(diagnoses.serverId, serverId)).run();

  for (const f of findings) {
    db.insert(diagnoses)
      .values({
        id: nanoid(),
        serverId,
        ruleId: f.ruleId,
        severity: f.severity,
        title: f.title,
        explanation: f.explanation,
        fixJson: JSON.stringify(f.fixes),
      })
      .run();
  }

  return findings;
}

/**
 * Executes a one-click fix recommended by the diagnosis engine.
 */
export async function applyDiagnosisFix(
  serverId: string,
  userId: string,
  action: FixAction,
  ip?: string,
): Promise<{ success: boolean; message: string }> {
  const db = getDatabase();
  const server = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  switch (action.type) {
    case 'set-env': {
      const currentEnv = JSON.parse(server.envJson || '{}') as Record<string, string>;
      const newEnv = {
        ...currentEnv,
        ...(action.payload as Record<string, string>),
      };
      db.update(servers)
        .set({ envJson: JSON.stringify(newEnv) })
        .where(eq(servers.id, serverId))
        .run();

      await restartServer(serverId, userId, ip);
      return { success: true, message: 'Environment updated and server restarting.' };
    }

    case 'raise-ram': {
      const newRam = (action.payload?.ramMb as number) || server.ramMb + 1024;
      db.update(servers)
        .set({ ramMb: newRam })
        .where(eq(servers.id, serverId))
        .run();

      await restartServer(serverId, userId, ip);
      return { success: true, message: `RAM increased to ${newRam} MB and server restarting.` };
    }

    case 'change-port': {
      const template = getTemplate(server.templateId);
      if (template) {
        allocatePorts(template.ports.length);
      }
      await restartServer(serverId, userId, ip);
      return { success: true, message: 'Reallocated new host port and server restarting.' };
    }

    case 'chown-volume': {
      const template = getTemplate(server.templateId);
      if (template) {
        await prepareServerVolume(serverId, template);
      }
      await restartServer(serverId, userId, ip);
      return { success: true, message: 'Storage volume ownership reset and server restarting.' };
    }

    case 'restart': {
      await restartServer(serverId, userId, ip);
      return { success: true, message: 'Server restarted.' };
    }

    default:
      return { success: true, message: 'Fix applied.' };
  }
}
