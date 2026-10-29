import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { buildTestApp, cleanupTestApp, registerAdmin } from './helpers.js';
import { safepath } from '../src/safepath.js';
import { getModsDirectory } from '../src/servers/mods.js';

describe('Server Mods & Plugins Management', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let serverId: string;

  beforeEach(async () => {
    app = await buildTestApp();

    const { cookies } = await registerAdmin(app);
    adminCookie = cookies['vr_session']!;

    // Create a Fabric Minecraft server
    const serverRes = await app.inject({
      method: 'POST',
      url: '/api/servers',
      cookies: { vr_session: adminCookie },
      payload: {
        name: 'Fabric Modded Realm',
        templateId: 'minecraft-java',
        env: {
          TYPE: 'FABRIC',
          VERSION: '1.21.4',
        },
      },
    });
    serverId = serverRes.json().id;
  });

  afterEach(() => {
    cleanupTestApp();
  });

  it('safepath blocks directory traversal outside base directory', () => {
    const baseDir = process.cwd();
    expect(() => safepath.resolve(baseDir, '../../etc/passwd')).toThrow(/path traversal detected/i);
    expect(() => safepath.resolve(baseDir, 'mods', '..', '..', 'evil.jar')).toThrow(/path traversal detected/i);
    expect(safepath.resolve(baseDir, 'mods', 'safe.jar')).toContain('safe.jar');
  });

  it('GET /api/servers/:id/mods returns empty list and mods folder name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/mods`,
      cookies: { vr_session: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.folder).toBe('mods');
    expect(body.mods).toEqual([]);
  });

  it('detects and lists placed mod files with enable/disable state', async () => {
    const modsDir = getModsDirectory(serverId, 'minecraft-java');
    fs.writeFileSync(`${modsDir}/sodium-fabric.jar`, 'mock jar bytes');
    fs.writeFileSync(`${modsDir}/lithium.jar.disabled`, 'mock disabled bytes');

    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/mods`,
      cookies: { vr_session: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mods).toHaveLength(2);

    const sodium = body.mods.find((m: { filename: string }) => m.filename === 'sodium-fabric.jar');
    expect(sodium).toBeDefined();
    expect(sodium!.enabled).toBe(true);

    const lithium = body.mods.find((m: { filename: string }) => m.filename === 'lithium.jar.disabled');
    expect(lithium).toBeDefined();
    expect(lithium!.enabled).toBe(false);
  });

  it('POST /api/servers/:id/mods/toggle disables and enables mods', async () => {
    const modsDir = getModsDirectory(serverId, 'minecraft-java');
    fs.writeFileSync(`${modsDir}/chunky.jar`, 'mock chunky jar');

    // Disable
    const disableRes = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/mods/toggle`,
      cookies: { vr_session: adminCookie },
      payload: {
        filename: 'chunky.jar',
        enable: false,
      },
    });

    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json().newFilename).toBe('chunky.jar.disabled');
    expect(fs.existsSync(`${modsDir}/chunky.jar.disabled`)).toBe(true);
    expect(fs.existsSync(`${modsDir}/chunky.jar`)).toBe(false);

    // Re-enable
    const enableRes = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/mods/toggle`,
      cookies: { vr_session: adminCookie },
      payload: {
        filename: 'chunky.jar.disabled',
        enable: true,
      },
    });

    expect(enableRes.statusCode).toBe(200);
    expect(enableRes.json().newFilename).toBe('chunky.jar');
    expect(fs.existsSync(`${modsDir}/chunky.jar`)).toBe(true);
  });

  it('DELETE /api/servers/:id/mods/:filename removes the mod file', async () => {
    const modsDir = getModsDirectory(serverId, 'minecraft-java');
    fs.writeFileSync(`${modsDir}/voice-chat.jar`, 'voice chat jar content');

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/servers/${serverId}/mods/voice-chat.jar`,
      cookies: { vr_session: adminCookie },
    });

    expect(delRes.statusCode).toBe(200);
    expect(fs.existsSync(`${modsDir}/voice-chat.jar`)).toBe(false);
  });
});
