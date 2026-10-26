import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import { buildTestApp, cleanupTestApp, registerAdmin, registerUser, createInvite } from './helpers.js';
import { getDatabase } from '../src/db/index.js';
import { servers, diagnoses } from '../src/db/schema.js';

describe('Phase 3 — Realtime & Debugging Integration', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let serverId: string;

  beforeEach(async () => {
    app = await buildTestApp();
    const { cookies } = await registerAdmin(app);
    adminCookie = cookies['vr_session']!;

    // Deploy a server
    const deployRes = await app.inject({
      method: 'POST',
      url: '/api/servers',
      cookies: { vr_session: adminCookie },
      payload: {
        name: 'Phase 3 Test Server',
        templateId: 'minecraft-java',
        ramMb: 2048,
      },
    });

    expect(deployRes.statusCode).toBe(201);
    serverId = deployRes.json().id;

    // Start server to get running status
    await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/start`,
      cookies: { vr_session: adminCookie },
    });
  });

  afterEach(() => {
    cleanupTestApp();
  });

  // ── Console Commands ────────────────────────────────────────────────────────
  describe('Console Command Execution', () => {
    it('executes command on running server and returns output', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/command`,
        cookies: { vr_session: adminCookie },
        payload: { command: 'say Hello VaultRealm' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.output).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    it('rejects command if server is stopped', async () => {
      // Stop server
      await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/stop`,
        cookies: { vr_session: adminCookie },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/command`,
        cookies: { vr_session: adminCookie },
        payload: { command: 'help' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('SERVER_NOT_RUNNING');
    });

    it('rejects command from unauthorized user without console permission', async () => {
      const inviteRes = await createInvite(app, adminCookie);
      const inviteCode = inviteRes.json().code;
      const { cookies: userCookies } = await registerUser(app, inviteCode, {
        email: 'other@test.com',
        username: 'otheruser',
      });
      const otherCookie = userCookies['vr_session']!;

      const res = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/command`,
        cookies: { vr_session: otherCookie },
        payload: { command: 'op me' },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── Diagnosis & Fixes ──────────────────────────────────────────────────────
  describe('Diagnosis & Fixes Engine', () => {
    it('runs diagnosis on server and records findings in database', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/servers/${serverId}/diagnose`,
        cookies: { vr_session: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      const findings = res.json();
      expect(Array.isArray(findings)).toBe(true);

      // Verify findings were recorded in DB
      const db = getDatabase();
      const dbFindings = db.select().from(diagnoses).where(eq(diagnoses.serverId, serverId)).all();
      expect(dbFindings.length).toBe(findings.length);
    });

    it('applies set-env fix successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/fixes/apply`,
        cookies: { vr_session: adminCookie },
        payload: {
          action: {
            type: 'set-env',
            payload: { EULA: 'TRUE', DIFFICULTY: 'hard' },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // Verify env was updated in DB
      const db = getDatabase();
      const s = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
      const env = JSON.parse(s!.envJson);
      expect(env.EULA).toBe('TRUE');
      expect(env.DIFFICULTY).toBe('hard');
    });

    it('applies raise-ram fix successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/fixes/apply`,
        cookies: { vr_session: adminCookie },
        payload: {
          action: {
            type: 'raise-ram',
            payload: { ramMb: 3072 },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // Verify RAM was updated in DB
      const db = getDatabase();
      const s = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
      expect(s!.ramMb).toBe(3072);
    });
  });

  // ── Debug Bundle ───────────────────────────────────────────────────────────
  describe('Debug Bundle with Secret Redaction', () => {
    it('generates a valid ZIP debug bundle with secrets redacted', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/servers/${serverId}/debug-bundle`,
        cookies: { vr_session: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toContain('attachment');

      const buf = res.rawPayload;
      // ZIP file starts with signature PK\x03\x04 (0x04034b50)
      expect(buf[0]).toBe(0x50); // 'P'
      expect(buf[1]).toBe(0x4b); // 'K'
      expect(buf[2]).toBe(0x03);
      expect(buf[3]).toBe(0x04);

      // Check contents of configuration inside zip
      const text = buf.toString('utf-8');
      expect(text).toContain('logs.txt');
      expect(text).toContain('inspect.json');
      expect(text).toContain('configuration.json');

      // Secrets must be redacted
      expect(text).not.toContain('RCON_PASSWORD":"secret');
    });

    it('prevents non-members from downloading debug bundle', async () => {
      const inviteRes = await createInvite(app, adminCookie);
      const inviteCode = inviteRes.json().code;
      const { cookies: userCookies } = await registerUser(app, inviteCode, {
        email: 'spy@test.com',
        username: 'spyuser',
      });
      const spyCookie = userCookies['vr_session']!;

      const res = await app.inject({
        method: 'GET',
        url: `/api/servers/${serverId}/debug-bundle`,
        cookies: { vr_session: spyCookie },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── WebSocket Gateway ──────────────────────────────────────────────────────
  describe('WebSocket Gateway /ws/servers/:id', () => {
    it('connects, authenticates, and exchanges console command messages', async () => {
      // Start Fastify server listening on an ephemeral port
      await app.listen({ port: 0, host: '127.0.0.1' });
      const port = (app.server.address() as { port: number }).port;

      const wsUrl = `ws://127.0.0.1:${port}/ws/servers/${serverId}`;
      const ws = new WebSocket(wsUrl, {
        headers: {
          Cookie: `vr_session=${adminCookie}`,
        },
      });

      const messages: Array<{ type: string; data: unknown }> = [];

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          // Send command message
          ws.send(JSON.stringify({ type: 'command', data: 'time set day' }));
        });

        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          messages.push(msg);

          if (msg.type === 'command_ack') {
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);
        setTimeout(() => reject(new Error('WebSocket timeout waiting for messages')), 4000);
      });

      expect(messages.some((m) => m.type === 'status')).toBe(true);
      expect(messages.some((m) => m.type === 'command_ack')).toBe(true);

      await app.close();
    });

    it('rejects unauthenticated WebSocket connection', async () => {
      await app.listen({ port: 0, host: '127.0.0.1' });
      const port = (app.server.address() as { port: number }).port;

      const wsUrl = `ws://127.0.0.1:${port}/ws/servers/${serverId}`;
      // Connect without cookie
      const ws = new WebSocket(wsUrl);

      const closed = await new Promise<number>((resolve) => {
        ws.on('close', (code) => {
          resolve(code);
        });
        ws.on('error', () => {
          // close may fire before or after error
        });
      });

      expect(closed).toBe(4401);
      await app.close();
    });
  });
});
