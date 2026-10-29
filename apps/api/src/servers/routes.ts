/**
 * Server routes — CRUD, power actions, deploy streaming, events, console, and debugging.
 *
 * Every route validates with zod, calls can() for permissions,
 * and writes an audit entry for mutations (AGENTS.md rules).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { requireAuth, getRequestUser } from '../auth/middleware.js';
import { assertCan } from '../auth/rbac.js';
import { validate } from '../validation.js';
import { getAllTemplates } from './templates.js';
import { getTemplateVersions } from './versions.js';
import {
  startServer,
  stopServer,
  restartServer,
  killServer,
  deleteServer,
  getServerDetail,
  listUserServers,
  getDockerDriver,
} from './service.js';
import { executeDeploy, subscribeDeployProgress, getDeployHistory } from './deploy.js';
import { getHostCapacityStatus, getUserQuotaUsage } from './quota.js';
import { getDatabase } from '../db/index.js';
import { events } from '../db/schema.js';
import { diagnoseServer, applyDiagnosisFix, type FixAction } from '../diagnosis/index.js';
import { generateDebugBundle } from './debug-bundle.js';
import { executeServerCommand } from './console.js';
import { getServerDiskUsage } from './volume.js';

// ── Validation schemas ───────────────────────────────────────────────────────

const createServerSchema = z.object({
  name: z
    .string()
    .min(1, 'Server name is required')
    .max(64, 'Server name must be at most 64 characters'),
  templateId: z.string().min(1, 'Template ID is required'),
  ramMb: z.number().int().min(256).max(65536).optional(),
  cpuLimit: z.number().int().min(1).max(16).optional(),
  diskLimitMb: z.number().int().min(512).max(204800).optional(),
  env: z.record(z.string()).optional(),
});

const commandSchema = z.object({
  command: z.string().min(1, 'Command cannot be empty'),
});

const applyFixSchema = z.object({
  action: z.object({
    type: z.enum([
      'set-env',
      'raise-ram',
      'change-port',
      'restart',
      'open-docs',
      'chown-volume',
      'clean-disk',
    ]),
    payload: z.record(z.unknown()).optional(),
  }),
});

// ── Route registration ───────────────────────────────────────────────────────

export async function serverRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/templates ─────────────────────────────────────────────────────
  app.get('/api/templates', { preHandler: [requireAuth] }, async () => {
    return getAllTemplates().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      minRamMb: t.minRamMb,
      defaultRamMb: t.defaultRamMb,
      defaultCpu: t.defaultCpu,
      defaultDiskMb: t.defaultDiskMb,
      ports: t.ports,
      env: t.env.filter((e) => !e.secret).map((e) => ({
        key: e.key,
        label: e.label,
        default: e.default,
        required: e.required,
        description: e.description,
        options: e.options,
      })),
    }));
  });

  // ── GET /api/templates/:templateId/versions ────────────────────────────────
  app.get('/api/templates/:templateId/versions', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = getRequestUser(request);
    await assertCan(user, 'server:create');

    const params = request.params as { templateId: string };
    const templateId = params.templateId;
    if (!templateId) {
      return reply.status(400).send({
        code: 'INVALID_TEMPLATE',
        message: 'Template ID is required.',
      });
    }

    const versions = await getTemplateVersions(templateId);
    return versions;
  });

  // ── GET /api/system/capacity ───────────────────────────────────────────────
  app.get('/api/system/capacity', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    return {
      host: getHostCapacityStatus(),
      user: getUserQuotaUsage(user.id),
    };
  });

  // ── GET /api/servers ───────────────────────────────────────────────────────
  app.get('/api/servers', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    await assertCan(user, 'server:list');
    return listUserServers(user.id);
  });

  // ── POST /api/servers (One-click 9-step deploy) ─────────────────────────────
  app.post('/api/servers', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = getRequestUser(request);
    await assertCan(user, 'server:create');

    const parsed = validate(createServerSchema, request.body, reply);
    if (!parsed.success) return;

    const result = await executeDeploy(user, {
      ...parsed.data,
      ip: request.ip,
    });
    return reply.status(201).send({
      id: result.serverId,
      name: result.name,
      status: result.status,
    });
  });

  // ── GET /api/servers/:id ───────────────────────────────────────────────────
  app.get('/api/servers/:id', { preHandler: [requireAuth] }, async (request, _reply) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:view', id);
    return getServerDetail(id);
  });

  // ── GET /api/servers/:id/events ────────────────────────────────────────────
  app.get('/api/servers/:id/events', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:view', id);

    const db = getDatabase();
    return db
      .select()
      .from(events)
      .where(eq(events.serverId, id))
      .orderBy(desc(events.ts))
      .limit(100)
      .all();
  });

  // ── GET /api/servers/:id/deploy-stream (SSE) ────────────────────────────────
  app.get('/api/servers/:id/deploy-stream', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:view', id);

    // Hijack the response so Fastify doesn't auto-send a reply
    // (required when writing directly to reply.raw for SSE)
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering if behind proxy
    });

    // Replay buffered events (steps 1-3 fire synchronously during POST
    // before the SSE client connects, so they'd otherwise be lost)
    const history = getDeployHistory(id);
    for (const evt of history) {
      reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
    }

    const unsubscribe = subscribeDeployProgress(id, (evt) => {
      reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
    });

    request.raw.on('close', () => {
      unsubscribe();
    });

    // Keep connection open until client disconnects
    await new Promise((resolve) => {
      request.raw.on('close', resolve);
    });
  });

  // ── POST /api/servers/:id/start ────────────────────────────────────────────
  app.post('/api/servers/:id/start', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:power', id);
    await startServer(id, user.id, request.ip);
    return { message: 'Server starting.' };
  });

  // ── POST /api/servers/:id/stop ─────────────────────────────────────────────
  app.post('/api/servers/:id/stop', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:power', id);
    await stopServer(id, user.id, request.ip);
    return { message: 'Server stopped.' };
  });

  // ── POST /api/servers/:id/restart ──────────────────────────────────────────
  app.post('/api/servers/:id/restart', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:power', id);
    await restartServer(id, user.id, request.ip);
    return { message: 'Server restarting.' };
  });

  // ── POST /api/servers/:id/kill ─────────────────────────────────────────────
  app.post('/api/servers/:id/kill', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:power', id);
    await killServer(id, user.id, request.ip);
    return { message: 'Server killed.' };
  });

  // ── DELETE /api/servers/:id ────────────────────────────────────────────────
  app.delete('/api/servers/:id', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:delete', id);
    await deleteServer(id, user.id, request.ip);
    return { message: 'Server deleted.' };
  });

  // ── GET /api/servers/:id/stats ─────────────────────────────────────────────
  app.get('/api/servers/:id/stats', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:view', id);

    const detail = await getServerDetail(id);
    const disk = getServerDiskUsage(id, detail.diskLimitMb);

    if (detail.status !== 'running') {
      return {
        cpuPercent: 0,
        memoryUsageMb: 0,
        memoryLimitMb: detail.ramMb,
        memoryPercent: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
        pids: 0,
        ...disk,
      };
    }

    const db = getDatabase();
    const { servers } = await import('../db/schema.js');
    const server = db.select({ containerId: servers.containerId }).from(servers).where(eq(servers.id, id)).all()[0];

    if (!server?.containerId) {
      return {
        cpuPercent: 0,
        memoryUsageMb: 0,
        memoryLimitMb: detail.ramMb,
        memoryPercent: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
        pids: 0,
        ...disk,
      };
    }

    try {
      const driver = getDockerDriver();
      const stats = await driver.getContainerStats(server.containerId);
      return {
        ...stats,
        ...disk,
      };
    } catch {
      return {
        cpuPercent: 0,
        memoryUsageMb: 0,
        memoryLimitMb: detail.ramMb,
        memoryPercent: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
        pids: 0,
        ...disk,
      };
    }
  });

  // ── POST /api/servers/:id/command (Console Execution) ──────────────────────
  app.post('/api/servers/:id/command', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:console', id);

    const parsed = validate(commandSchema, request.body, reply);
    if (!parsed.success) return;

    const result = await executeServerCommand(id, user.id, parsed.data.command, request.ip);
    return reply.status(200).send(result);
  });

  // ── GET /api/servers/:id/diagnose (Diagnosis Engine) ───────────────────────
  app.get('/api/servers/:id/diagnose', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:view', id);

    return diagnoseServer(id);
  });

  // ── POST /api/servers/:id/fixes/apply ──────────────────────────────────────
  app.post('/api/servers/:id/fixes/apply', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:diagnosis', id);

    const parsed = validate(applyFixSchema, request.body, reply);
    if (!parsed.success) return;

    const result = await applyDiagnosisFix(
      id,
      user.id,
      parsed.data.action as FixAction,
      request.ip,
    );
    return reply.status(200).send(result);
  });

  // ── GET /api/servers/:id/debug-bundle (Download Debug ZIP) ──────────────────
  app.get('/api/servers/:id/debug-bundle', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = getRequestUser(request);
    const { id } = request.params as { id: string };
    await assertCan(user, 'server:view', id);

    const zipBuffer = await generateDebugBundle(id);
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="vaultrealm-debug-${id}.zip"`)
      .send(zipBuffer);
  });
}
