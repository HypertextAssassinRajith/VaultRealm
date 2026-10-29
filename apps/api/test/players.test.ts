import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { buildTestApp, cleanupTestApp, registerAdmin } from './helpers.js';
import { getServerDataDir } from '../src/servers/volume.js';
import { safepath } from '../src/safepath.js';

describe('Player & Moderation Management', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let serverId: string;

  beforeEach(async () => {
    app = await buildTestApp();

    const { cookies } = await registerAdmin(app);
    adminCookie = cookies['vr_session']!;

    // Create a Minecraft server
    const serverRes = await app.inject({
      method: 'POST',
      url: '/api/servers',
      cookies: { vr_session: adminCookie },
      payload: {
        name: 'Mod Testing Server',
        templateId: 'minecraft-java',
        env: {
          TYPE: 'PAPER',
        },
      },
    });
    serverId = serverRes.json().id;
  });

  afterEach(() => {
    cleanupTestApp();
  });

  it('GET /api/servers/:id/players returns initial empty moderation lists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/players`,
      cookies: { vr_session: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.online).toBeDefined();
    expect(body.bannedPlayers).toEqual([]);
    expect(body.bannedIps).toEqual([]);
    expect(body.ops).toEqual([]);
  });

  it('GET /api/servers/:id/players reads banned-players.json and banned-ips.json from volume', async () => {
    const serverDir = getServerDataDir(serverId);
    const bannedPlayers = [
      {
        name: 'Griefer99',
        uuid: '1111-2222',
        reason: 'Illegal items',
        created: '2026-10-29 10:00:00',
        source: 'Admin',
      },
    ];
    const bannedIps = [
      {
        ip: '10.0.0.55',
        reason: 'Bot attack',
        created: '2026-10-29 10:05:00',
        source: 'Admin',
      },
    ];

    fs.writeFileSync(safepath.resolve(serverDir, 'banned-players.json'), JSON.stringify(bannedPlayers));
    fs.writeFileSync(safepath.resolve(serverDir, 'banned-ips.json'), JSON.stringify(bannedIps));

    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/players`,
      cookies: { vr_session: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bannedPlayers).toHaveLength(1);
    expect(body.bannedPlayers[0].name).toBe('Griefer99');
    expect(body.bannedIps).toHaveLength(1);
    expect(body.bannedIps[0].ip).toBe('10.0.0.55');
  });

  it('POST /api/servers/:id/players/kick kicks a player on running server and rejects when stopped', async () => {
    // 1. Kick on running server
    const kickRes = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/players/kick`,
      cookies: { vr_session: adminCookie },
      payload: {
        player: 'BadPlayer',
        reason: 'Spamming',
      },
    });
    expect(kickRes.statusCode).toBe(200);
    expect(kickRes.json().success).toBe(true);

    // 2. Stop server
    await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/stop`,
      cookies: { vr_session: adminCookie },
    });

    // 3. Kick rejects when stopped
    const stoppedKickRes = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/players/kick`,
      cookies: { vr_session: adminCookie },
      payload: {
        player: 'BadPlayer',
      },
    });

    expect(stoppedKickRes.statusCode).toBe(400);
    expect(stoppedKickRes.json().code).toBe('SERVER_NOT_RUNNING');
  });

  it('POST /api/servers/:id/players/ban rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/players/ban`,
      payload: {
        player: 'BadPlayer',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /api/servers/:id/players/ban-ip validates input parameters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/players/ban-ip`,
      cookies: { vr_session: adminCookie },
      payload: {
        ipOrPlayer: '',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});
