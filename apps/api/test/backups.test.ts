import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp,
  cleanupTestApp,
  registerAdmin,
  registerUser,
  createInvite,
} from './helpers.js';
import { getServerDataDir } from '../src/servers/volume.js';

describe('Server Backups & Google Drive Integration', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let serverId: string;

  beforeEach(async () => {
    app = await buildTestApp();
    const { cookies } = await registerAdmin(app);
    adminCookie = cookies['vr_session']!;

    // Create a game server
    const serverRes = await app.inject({
      method: 'POST',
      url: '/api/servers',
      cookies: { vr_session: adminCookie },
      payload: { name: 'Backup Test Server', templateId: 'minecraft-java' },
    });
    serverId = serverRes.json().id;

    // Create mock files in the server volume
    const serverDir = getServerDataDir(serverId);
    fs.mkdirSync(serverDir, { recursive: true });
    fs.writeFileSync(path.join(serverDir, 'server.properties'), 'motd=TestServer\nonline-mode=false\n');
    fs.mkdirSync(path.join(serverDir, 'world'), { recursive: true });
    fs.writeFileSync(path.join(serverDir, 'world', 'level.dat'), 'MOCK_LEVEL_DATA_BYTES');
  });

  afterEach(() => {
    cleanupTestApp();
    vi.restoreAllMocks();
  });

  describe('Server Backups Lifecycle', () => {
    it('creates a local server backup successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/backups`,
        cookies: { vr_session: adminCookie },
        payload: { name: 'Initial World Save' },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.id).toBeDefined();
      expect(data.serverId).toBe(serverId);
      expect(data.name).toBe('Initial World Save');
      expect(data.sizeBytes).toBeGreaterThan(0);
      expect(data.localExists).toBe(true);
      expect(fs.existsSync(data.path)).toBe(true);
    });

    it('lists server backups', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/backups`,
        cookies: { vr_session: adminCookie },
        payload: { name: 'Snapshot 1' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/servers/${serverId}/backups`,
        cookies: { vr_session: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.backups).toBeInstanceOf(Array);
      expect(data.backups.length).toBe(1);
      expect(data.backups[0].name).toBe('Snapshot 1');
      expect(data.backups[0].localExists).toBe(true);
    });

    it('downloads a server backup archive', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/backups`,
        cookies: { vr_session: adminCookie },
      });
      const backupId = createRes.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/servers/${serverId}/backups/${backupId}/download`,
        cookies: { vr_session: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/gzip');
      expect(res.headers['content-disposition']).toContain('attachment; filename=');
      expect(res.rawPayload.length).toBeGreaterThan(0);
    });

    it('restores a server from backup snapshot', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/backups`,
        cookies: { vr_session: adminCookie },
      });
      const backupId = createRes.json().id;

      // Simulate modification / deletion of world file
      const serverDir = getServerDataDir(serverId);
      const levelDatPath = path.join(serverDir, 'world', 'level.dat');
      fs.writeFileSync(levelDatPath, 'CORRUPTED_OR_CHANGED_DATA');

      // Restore backup
      const restoreRes = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/backups/${backupId}/restore`,
        cookies: { vr_session: adminCookie },
      });

      expect(restoreRes.statusCode).toBe(200);
      expect(restoreRes.json().message).toContain('restored');

      // Verify original file was restored
      const restoredContent = fs.readFileSync(levelDatPath, 'utf8');
      expect(restoredContent).toBe('MOCK_LEVEL_DATA_BYTES');
    });

    it('deletes a server backup', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/backups`,
        cookies: { vr_session: adminCookie },
      });
      const backup = createRes.json();
      expect(fs.existsSync(backup.path)).toBe(true);

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/servers/${serverId}/backups/${backup.id}`,
        cookies: { vr_session: adminCookie },
      });

      expect(delRes.statusCode).toBe(200);
      expect(fs.existsSync(backup.path)).toBe(false);

      const listRes = await app.inject({
        method: 'GET',
        url: `/api/servers/${serverId}/backups`,
        cookies: { vr_session: adminCookie },
      });
      expect(listRes.json().backups).toHaveLength(0);
    });

    it('enforces RBAC permissions on backup endpoints', async () => {
      const inviteRes = await createInvite(app, adminCookie);
      const { cookies: userCookies } = await registerUser(app, inviteRes.json().code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/backups`,
        cookies: { vr_session: userCookies['vr_session']! },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('Google Drive OAuth & Configuration', () => {
    it('returns configured: false when not set up', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/system/google-drive',
        cookies: { vr_session: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().configured).toBe(false);
    });

    it('saves and masks Google Drive OAuth config with mocked token test', async () => {
      // Mock global fetch for Google Drive OAuth verification
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: 'mock_access_token_123', expires_in: 3600 }), {
              status: 200,
            }),
          );
        }
        if (urlStr.includes('googleapis.com/drive/v3/about')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user: { displayName: 'VaultRealm Admin', emailAddress: 'admin@vaultrealm.io' },
                storageQuota: { limit: '107374182400', usage: '53687091200' },
              }),
              { status: 200 },
            ),
          );
        }
        return originalFetch(url);
      });

      const putRes = await app.inject({
        method: 'PUT',
        url: '/api/system/google-drive',
        cookies: { vr_session: adminCookie },
        payload: {
          clientId: '123456789-abcdef.apps.googleusercontent.com',
          clientSecret: 'GOCSPX-secret123456',
          refreshToken: '1//04mock_refresh_token_xyz',
        },
      });

      expect(putRes.statusCode).toBe(200);
      const data = putRes.json();
      expect(data.config.configured).toBe(true);
      expect(data.config.userEmail).toBe('admin@vaultrealm.io');
      expect(data.config.clientId).toContain('***');

      // Test endpoint
      const testRes = await app.inject({
        method: 'POST',
        url: '/api/system/google-drive/test',
        cookies: { vr_session: adminCookie },
      });
      expect(testRes.statusCode).toBe(200);
      expect(testRes.json().details.displayName).toBe('VaultRealm Admin');
    });

    it('detects CLIENT_ID and CLIENT_SECRET from environment aliases', async () => {
      const origClientId = process.env.CLIENT_ID;
      const origClientSecret = process.env.CLIENT_SECRET;
      try {
        process.env.CLIENT_ID = '772379419361-env-alias.apps.googleusercontent.com';
        process.env.CLIENT_SECRET = 'GOCSPX-secretalias';

        const configRes = await app.inject({
          method: 'GET',
          url: '/api/system/google-drive',
          cookies: { vr_session: adminCookie },
        });

        expect(configRes.statusCode).toBe(200);
        const configData = configRes.json();
        expect(configData.hasEnvCredentials).toBe(true);
        expect(configData.clientId).toBe('772379419361-env-alias.apps.googleusercontent.com');
      } finally {
        if (origClientId !== undefined) process.env.CLIENT_ID = origClientId;
        else delete process.env.CLIENT_ID;
        if (origClientSecret !== undefined) process.env.CLIENT_SECRET = origClientSecret;
        else delete process.env.CLIENT_SECRET;
      }
    });

    it('generates Google OAuth authorization URL for 1-click Sign-in', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/system/google-drive/auth-url?clientId=custom-client-id.apps.googleusercontent.com',
        cookies: { vr_session: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.url).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(data.url).toContain('custom-client-id.apps.googleusercontent.com');
      expect(data.redirectUri).toBeDefined();
    });

    it('saves OAuth app credentials and generates auth URL via POST', async () => {
      const credsRes = await app.inject({
        method: 'POST',
        url: '/api/system/google-drive/credentials',
        cookies: { vr_session: adminCookie },
        payload: {
          clientId: '772379419361-posttest.apps.googleusercontent.com',
          clientSecret: 'GOCSPX-secretposttest',
        },
      });

      expect(credsRes.statusCode).toBe(200);
      expect(credsRes.json().config.hasClientCredentials).toBe(true);

      const postAuthRes = await app.inject({
        method: 'POST',
        url: '/api/system/google-drive/auth-url',
        cookies: { vr_session: adminCookie },
        payload: {
          redirectUri: 'https://realm.vaultsoftlabs.tech/api/system/google-drive/callback',
        },
      });

      expect(postAuthRes.statusCode).toBe(200);
      const authData = postAuthRes.json();
      expect(authData.url).toContain('772379419361-posttest.apps.googleusercontent.com');
      expect(authData.url).toContain('redirect_uri=https%3A%2F%2Frealm.vaultsoftlabs.tech%2Fapi%2Fsystem%2Fgoogle-drive%2Fcallback');
    });

    it('connects via Shared Folder Webhook (Google Apps Script)', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('script.google.com')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, folderName: 'Minecraft Community Backups', folderId: 'folder_123' }),
              { status: 200 },
            ),
          );
        }
        return originalFetch(url);
      });

      const putRes = await app.inject({
        method: 'PUT',
        url: '/api/system/google-drive',
        cookies: { vr_session: adminCookie },
        payload: {
          mode: 'webhook',
          webhookUrl: 'https://script.google.com/macros/s/AKfycb_mock_app_script_test/exec',
          folderId: 'folder_123',
        },
      });

      expect(putRes.statusCode).toBe(200);
      const data = putRes.json();
      expect(data.config.configured).toBe(true);
      expect(data.config.mode).toBe('webhook');
      expect(data.config.folderName).toBe('Minecraft Community Backups');
    });
  });

  describe('Full System Disaster Recovery Backup', () => {
    it('creates a full panel system backup', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/system/backups',
        cookies: { vr_session: adminCookie },
        payload: { uploadToDrive: false },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.id).toBeDefined();
      expect(data.filename).toContain('vaultrealm_full_system_');
      expect(data.sizeBytes).toBeGreaterThan(0);
      expect(fs.existsSync(data.path)).toBe(true);

      // List system backups
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/system/backups',
        cookies: { vr_session: adminCookie },
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().backups.length).toBeGreaterThan(0);
    });
  });
});

