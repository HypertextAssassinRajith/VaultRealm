/**
 * Bot lifecycle and configuration routes.
 *
 * Provides CRUD for per-server bots, container spawn/despawn via DockerDriver,
 * and quick in-panel companion actions.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDatabase } from '../db/index.js';
import { bots, servers, serverPorts, events, llmEndpoints, users } from '../db/schema.js';
import { requireAuth, getRequestUser } from '../auth/middleware.js';
import { assertCan } from '../auth/rbac.js';
import { validate } from '../validation.js';
import { writeAudit } from '../audit/log.js';
import { getConfig } from '../config.js';
import { getDockerDriver } from '../servers/service.js';
import { createBotToken } from './bot-tokens.js';

// ── Validation Schemas ────────────────────────────────────────────────────────

const updateBotSchema = z.object({
  endpointId: z.string().min(1, 'LLM Endpoint is required'),
  name: z.string().min(1).max(32).default('Buddy'),
  persona: z.string().min(1).max(500).default('helpful friend'),
  model: z.string().max(100).optional().nullable(),
  mode: z.enum(['off', 'manual', 'auto-solo', 'always']).default('manual'),
  authMode: z.enum(['offline', 'microsoft', 'proxy']).default('offline'),
  whoCanCommand: z.string().default('owner'),
  dailyTokenBudget: z.number().int().min(1000).max(10_000_000).default(200_000),
  rpmLimit: z.number().int().min(1).max(120).default(10),
  proactive: z.boolean().default(false),
});

const botActionSchema = z.object({
  action: z.enum(['stop', 'follow', 'come', 'status', 'say']),
  message: z.string().max(256).optional(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export async function botRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  // ── GET /api/servers/:id/companion/bot — get bot config and status ────────
  app.get<{ Params: { id: string } }>('/api/servers/:id/companion/bot', async (request, reply) => {
    const user = getRequestUser(request);
    const { id: serverId } = request.params;
    await assertCan(user, 'companion:view', serverId);

    const db = getDatabase();
    const existing = db.select().from(bots).where(eq(bots.serverId, serverId)).all()[0];

    if (!existing) {
      return reply.send({ configured: false, bot: null });
    }

    return reply.send({
      configured: true,
      bot: {
        id: existing.id,
        serverId: existing.serverId,
        endpointId: existing.endpointId,
        name: existing.name,
        persona: existing.persona,
        model: existing.model,
        mode: existing.mode,
        authMode: existing.authMode,
        whoCanCommand: existing.whoCanCommand,
        proactive: existing.proactive,
        dailyTokenBudget: existing.dailyTokenBudget,
        rpmLimit: existing.rpmLimit,
        status: existing.status,
        containerId: existing.containerId,
        lastSpawnedAt: existing.lastSpawnedAt,
        lastDespawnedAt: existing.lastDespawnedAt,
        errorMessage: existing.errorMessage,
        createdAt: existing.createdAt,
      },
    });
  });

  // ── PUT /api/servers/:id/companion/bot — configure or update bot ──────────
  app.put<{ Params: { id: string } }>('/api/servers/:id/companion/bot', async (request, reply) => {
    const user = getRequestUser(request);
    const { id: serverId } = request.params;
    await assertCan(user, 'companion:manage', serverId);

    const parsed = validate(updateBotSchema, request.body, reply);
    if (!parsed.success) return;
    const data = parsed.data;

    const db = getDatabase();

    // Verify server exists
    const server = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
    if (!server) {
      return reply.status(404).send({ code: 'SERVER_NOT_FOUND', message: 'Server not found.' });
    }

    // Verify endpoint exists
    const endpoint = db.select().from(llmEndpoints).where(eq(llmEndpoints.id, data.endpointId)).all()[0];
    if (!endpoint) {
      return reply.status(404).send({ code: 'ENDPOINT_NOT_FOUND', message: 'Selected LLM Endpoint not found.' });
    }

    const existing = db.select().from(bots).where(eq(bots.serverId, serverId)).all()[0];
    let botId: string;

    if (existing) {
      botId = existing.id;
      db.update(bots)
        .set({
          endpointId: data.endpointId,
          name: data.name,
          persona: data.persona,
          model: data.model ?? null,
          mode: data.mode,
          authMode: data.authMode,
          whoCanCommand: data.whoCanCommand,
          dailyTokenBudget: data.dailyTokenBudget,
          rpmLimit: data.rpmLimit,
          proactive: data.proactive,
        })
        .where(eq(bots.id, botId))
        .run();
    } else {
      botId = nanoid();
      db.insert(bots)
        .values({
          id: botId,
          serverId,
          endpointId: data.endpointId,
          name: data.name,
          persona: data.persona,
          model: data.model ?? null,
          mode: data.mode,
          authMode: data.authMode,
          whoCanCommand: data.whoCanCommand,
          dailyTokenBudget: data.dailyTokenBudget,
          rpmLimit: data.rpmLimit,
          proactive: data.proactive,
          status: 'offline',
        })
        .run();
    }

    writeAudit({
      userId: user.id,
      action: 'bot.configure',
      target: botId,
      ip: request.ip,
      data: { serverId, name: data.name, endpointId: data.endpointId },
    });

    return reply.send({
      id: botId,
      serverId,
      name: data.name,
      status: existing?.status ?? 'offline',
    });
  });

  // ── POST /api/servers/:id/companion/bot/spawn — spawn bot container ──────
  app.post<{ Params: { id: string } }>('/api/servers/:id/companion/bot/spawn', async (request, reply) => {
    const user = getRequestUser(request);
    const { id: serverId } = request.params;
    await assertCan(user, 'companion:spawn', serverId);

    const db = getDatabase();

    const server = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
    if (!server) {
      return reply.status(404).send({ code: 'SERVER_NOT_FOUND', message: 'Server not found.' });
    }
    if (server.status !== 'running') {
      return reply.status(400).send({
        code: 'SERVER_NOT_RUNNING',
        message: 'Game server must be running before spawning an AI companion.',
      });
    }

    const bot = db.select().from(bots).where(eq(bots.serverId, serverId)).all()[0];
    if (!bot) {
      return reply.status(400).send({
        code: 'BOT_NOT_CONFIGURED',
        message: 'AI Companion is not configured for this server. Configure it first.',
      });
    }

    if (bot.status === 'joining' || bot.status === 'online') {
      return reply.status(409).send({
        code: 'BOT_ALREADY_SPAWNED',
        message: `Bot "${bot.name}" is already active (${bot.status}).`,
      });
    }

    // Retrieve server ports to find game port
    const ports = db.select().from(serverPorts).where(eq(serverPorts.serverId, serverId)).all();
    const gamePortEntry = ports.find((p) => p.name === 'game' || p.containerPort === 25565) ?? ports[0];
    const serverPort = gamePortEntry ? gamePortEntry.containerPort : 25565;

    const token = createBotToken(bot.id, 86400); // 24h token
    const config = getConfig();
    const driver = getDockerDriver();

    try {
      // Clean up any stale container if exists
      if (bot.containerId) {
        await driver.stopContainer(bot.containerId, 2).catch(() => {});
        await driver.removeContainer(bot.containerId).catch(() => {});
      }

      const userRecord = db.select().from(users).where(eq(users.id, user.id)).all()[0];
      const ownerName = userRecord?.username ?? 'admin';

      const containerName = `vaultrealm-bot-${bot.id}`;
      const containerId = await driver.createContainer({
        name: containerName,
        image: config.BOT_RUNNER_IMAGE,
        labels: {
          'vaultrealm.bot': bot.id,
          'vaultrealm.server': serverId,
        },
        env: {
          BOT_ID: bot.id,
          BOT_NAME: bot.name,
          SERVER_ID: serverId,
          SERVER_HOST: server.containerId || 'localhost',
          SERVER_PORT: String(serverPort),
          AUTH_MODE: bot.authMode,
          PERSONA: bot.persona,
          PANEL_GATEWAY_URL: config.PANEL_GATEWAY_URL,
          BOT_TOKEN: token,
          OWNER_NAME: ownerName,
          WHO_CAN_COMMAND: bot.whoCanCommand,
          PROTECTED_ZONES_JSON: bot.protectedZonesJson || '[]',
        },
        ports: [],
        volumes: [],
        memoryMb: 256,
        cpuLimit: 0.5,
        restartPolicy: 'on-failure',
      });

      await driver.startContainer(containerId);

      const now = new Date().toISOString();
      db.update(bots)
        .set({
          status: 'joining',
          containerId,
          lastSpawnedAt: now,
          errorMessage: null,
        })
        .where(eq(bots.id, bot.id))
        .run();

      db.insert(events)
        .values({
          id: nanoid(),
          serverId,
          kind: 'bot.spawn',
          message: `Companion bot "${bot.name}" spawned into server.`,
          dataJson: JSON.stringify({ botId: bot.id, containerId }),
        })
        .run();

      writeAudit({
        userId: user.id,
        action: 'bot.spawn',
        target: bot.id,
        ip: request.ip,
        data: { serverId, containerId },
      });

      return reply.send({ success: true, status: 'joining', containerId });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      db.update(bots)
        .set({
          status: 'error',
          errorMessage: errMsg,
        })
        .where(eq(bots.id, bot.id))
        .run();

      db.insert(events)
        .values({
          id: nanoid(),
          serverId,
          kind: 'bot.error',
          message: `Failed to spawn bot: ${errMsg}`,
        })
        .run();

      return reply.status(500).send({
        code: 'SPAWN_FAILED',
        message: `Failed to start companion bot container: ${errMsg}`,
      });
    }
  });

  // ── POST /api/servers/:id/companion/bot/despawn — stop/remove bot container
  app.post<{ Params: { id: string } }>('/api/servers/:id/companion/bot/despawn', async (request, reply) => {
    const user = getRequestUser(request);
    const { id: serverId } = request.params;
    await assertCan(user, 'companion:spawn', serverId);

    const db = getDatabase();
    const bot = db.select().from(bots).where(eq(bots.serverId, serverId)).all()[0];
    if (!bot) {
      return reply.status(404).send({ code: 'BOT_NOT_FOUND', message: 'No companion bot configured.' });
    }

    const driver = getDockerDriver();

    if (bot.containerId) {
      try {
        await driver.stopContainer(bot.containerId, 5).catch(() => {});
        await driver.removeContainer(bot.containerId).catch(() => {});
      } catch {
        // Container may have already exited
      }
    }

    const now = new Date().toISOString();
    db.update(bots)
      .set({
        status: 'offline',
        containerId: null,
        lastDespawnedAt: now,
      })
      .where(eq(bots.id, bot.id))
      .run();

    db.insert(events)
      .values({
        id: nanoid(),
        serverId,
        kind: 'bot.despawn',
        message: `Companion bot "${bot.name}" despawned.`,
      })
      .run();

    writeAudit({
      userId: user.id,
      action: 'bot.despawn',
      target: bot.id,
      ip: request.ip,
      data: { serverId },
    });

    return reply.send({ success: true, status: 'offline' });
  });

  // ── POST /api/servers/:id/companion/bot/action — quick companion action ──
  app.post<{ Params: { id: string } }>('/api/servers/:id/companion/bot/action', async (request, reply) => {
    const user = getRequestUser(request);
    const { id: serverId } = request.params;
    await assertCan(user, 'companion:manage', serverId);

    const parsed = validate(botActionSchema, request.body, reply);
    if (!parsed.success) return;
    const { action, message } = parsed.data;

    const db = getDatabase();
    const bot = db.select().from(bots).where(eq(bots.serverId, serverId)).all()[0];
    if (!bot) {
      return reply.status(404).send({ code: 'BOT_NOT_FOUND', message: 'No companion bot configured.' });
    }

    writeAudit({
      userId: user.id,
      action: 'bot.action',
      target: bot.id,
      ip: request.ip,
      data: { serverId, action, message },
    });

    return reply.send({
      success: true,
      action,
      executedAt: new Date().toISOString(),
    });
  });
}
