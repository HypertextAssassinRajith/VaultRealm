/**
 * Fastify routes for Game Server Backups, Full System Disaster Recovery,
 * and Google Drive OAuth2 integration.
 *
 * Enforces Zod validation, RBAC can() checks, and audit logging per AGENTS.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, getRequestUser } from '../auth/middleware.js';
import { assertCan } from '../auth/rbac.js';
import {
  createServerBackup,
  listServerBackups,
  restoreServerBackup,
  deleteServerBackup,
  uploadBackupToDrive,
  createFullSystemBackup,
  listSystemBackups,
  getBackupsDir,
} from './service.js';
import {
  getPublicDriveConfig,
  saveDriveConfig,
  deleteDriveConfig,
  testGoogleDriveConnection,
  getGoogleDriveAuthUrl,
  exchangeAuthCode,
} from './gdrive.js';

const createBackupSchema = z.object({
  name: z.string().max(80).optional(),
  uploadToDrive: z.boolean().optional().default(false),
});

const driveConfigSchema = z.object({
  mode: z.enum(['oauth', 'webhook']).optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  refreshToken: z.string().optional(),
  folderId: z.string().optional(),
  webhookUrl: z.string().url('Invalid Webhook URL format').optional(),
});

const exchangeCodeSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  redirectUri: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  folderId: z.string().optional(),
});

const systemBackupSchema = z.object({
  uploadToDrive: z.boolean().optional().default(false),
});

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  // ── Server Backup Routes ───────────────────────────────────────────────────

  // GET /api/servers/:id/backups
  app.get<{ Params: { id: string } }>(
    '/api/servers/:id/backups',
    { preHandler: [requireAuth] },
    async (request) => {
      const user = getRequestUser(request);
      const { id: serverId } = request.params;
      await assertCan(user, 'server:backups', serverId);

      const backupsList = await listServerBackups(serverId);
      return { backups: backupsList };
    },
  );

  // POST /api/servers/:id/backups
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/servers/:id/backups',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getRequestUser(request);
      const { id: serverId } = request.params;
      await assertCan(user, 'server:backups', serverId);

      const parsed = createBackupSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid backup parameters.',
          details: parsed.error.issues.map((i) => i.message),
        });
      }

      const backup = await createServerBackup(serverId, user.id, parsed.data, request.ip);
      return reply.status(201).send(backup);
    },
  );

  // POST /api/servers/:id/backups/:backupId/restore
  app.post<{ Params: { id: string; backupId: string } }>(
    '/api/servers/:id/backups/:backupId/restore',
    { preHandler: [requireAuth] },
    async (request) => {
      const user = getRequestUser(request);
      const { id: serverId, backupId } = request.params;
      await assertCan(user, 'server:backups', serverId);

      await restoreServerBackup(serverId, backupId, user.id, request.ip);
      return { message: 'Server successfully restored from backup snapshot.' };
    },
  );

  // POST /api/servers/:id/backups/:backupId/upload-drive
  app.post<{ Params: { id: string; backupId: string } }>(
    '/api/servers/:id/backups/:backupId/upload-drive',
    { preHandler: [requireAuth] },
    async (request) => {
      const user = getRequestUser(request);
      const { id: serverId, backupId } = request.params;
      await assertCan(user, 'server:backups', serverId);

      const updated = await uploadBackupToDrive(serverId, backupId, user.id, request.ip);
      return updated;
    },
  );

  // GET /api/servers/:id/backups/:backupId/download
  app.get<{ Params: { id: string; backupId: string } }>(
    '/api/servers/:id/backups/:backupId/download',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getRequestUser(request);
      const { id: serverId, backupId } = request.params;
      await assertCan(user, 'server:backups', serverId);

      const backupsList = await listServerBackups(serverId);
      const backup = backupsList.find((b) => b.id === backupId);
      if (!backup) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Backup not found.' });
      }

      if (!fs.existsSync(backup.path)) {
        return reply.status(404).send({
          code: 'FILE_NOT_FOUND',
          message: 'Local backup file is missing. If synced, download from Google Drive.',
        });
      }

      const filename = path.basename(backup.path);
      const stream = fs.createReadStream(backup.path);

      reply.header('Content-Type', 'application/gzip');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(stream);
    },
  );

  // DELETE /api/servers/:id/backups/:backupId
  app.delete<{ Params: { id: string; backupId: string } }>(
    '/api/servers/:id/backups/:backupId',
    { preHandler: [requireAuth] },
    async (request) => {
      const user = getRequestUser(request);
      const { id: serverId, backupId } = request.params;
      await assertCan(user, 'server:backups', serverId);

      await deleteServerBackup(serverId, backupId, user.id, request.ip);
      return { message: 'Backup successfully deleted.' };
    },
  );

  // ── Google Drive & Full System Backup Routes ───────────────────────────────

  // GET /api/system/google-drive
  app.get('/api/system/google-drive', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    await assertCan(user, 'admin:system');
    return getPublicDriveConfig();
  });

  // GET /api/system/google-drive/auth-url (1-click Sign in with Google)
  app.get<{ Querystring: { redirectUri?: string; clientId?: string } }>(
    '/api/system/google-drive/auth-url',
    { preHandler: [requireAuth] },
    async (request) => {
      const user = getRequestUser(request);
      await assertCan(user, 'admin:system');

      const protocol = request.protocol || 'http';
      const host = request.headers.host || 'localhost:3001';
      const defaultRedirectUri = `${protocol}://${host}/api/system/google-drive/callback`;
      const redirectUri = request.query.redirectUri || defaultRedirectUri;

      const url = getGoogleDriveAuthUrl({
        clientId: request.query.clientId,
        redirectUri,
      });

      return { url, redirectUri };
    },
  );

  // GET /api/system/google-drive/callback (Google OAuth redirect handler)
  app.get<{ Querystring: { code?: string; error?: string; state?: string } }>(
    '/api/system/google-drive/callback',
    async (request, reply) => {
      const { code, error } = request.query;
      reply.type('text/html');

      if (error || !code) {
        return reply.send(`
          <!DOCTYPE html>
          <html>
          <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:2rem;background:#1e293b;border-radius:1rem;border:1px solid #ef4444;max-width:420px;">
              <div style="font-size:3rem;margin-bottom:1rem;">❌</div>
              <h2 style="margin:0 0 0.5rem 0;color:#ef4444;">Google Sign-In Cancelled</h2>
              <p style="color:#94a3b8;font-size:0.875rem;">${error || 'Authorization code was not provided.'}</p>
              <button onclick="window.close()" style="margin-top:1rem;padding:0.5rem 1.25rem;background:#334155;color:#fff;border:none;border-radius:0.5rem;cursor:pointer;">Close Window</button>
            </div>
          </body>
          </html>
        `);
      }

      try {
        const protocol = request.protocol || 'http';
        const host = request.headers.host || 'localhost:3001';
        const redirectUri = `${protocol}://${host}/api/system/google-drive/callback`;

        const config = await exchangeAuthCode({ code, redirectUri });

        return reply.send(`
          <!DOCTYPE html>
          <html>
          <head><title>Google Drive Connected</title></head>
          <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:2rem;background:#1e293b;border-radius:1rem;border:1px solid #10b981;max-width:420px;">
              <div style="font-size:3rem;margin-bottom:1rem;">✅</div>
              <h2 style="margin:0 0 0.5rem 0;color:#10b981;">Google Drive Connected!</h2>
              <p style="color:#94a3b8;font-size:0.875rem;margin-bottom:1.5rem;">
                Connected as <strong>${config.userName || config.userEmail || 'Google User'}</strong>
              </p>
              <p style="color:#64748b;font-size:0.75rem;">Closing window automatically...</p>
            </div>
            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'GDRIVE_AUTH_SUCCESS', config: ${JSON.stringify(config)} }, '*');
                  setTimeout(() => window.close(), 1000);
                } else {
                  setTimeout(() => { window.location.href = '/?gdrive=connected'; }, 1200);
                }
              } catch(e) {}
            </script>
          </body>
          </html>
        `);
      } catch (err) {
        return reply.send(`
          <!DOCTYPE html>
          <html>
          <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:2rem;background:#1e293b;border-radius:1rem;border:1px solid #ef4444;max-width:420px;">
              <div style="font-size:3rem;margin-bottom:1rem;">❌</div>
              <h2 style="margin:0 0 0.5rem 0;color:#ef4444;">Connection Failed</h2>
              <p style="color:#94a3b8;font-size:0.875rem;">${err instanceof Error ? err.message : String(err)}</p>
              <button onclick="window.close()" style="margin-top:1rem;padding:0.5rem 1.25rem;background:#334155;color:#fff;border:none;border-radius:0.5rem;cursor:pointer;">Close Window</button>
            </div>
          </body>
          </html>
        `);
      }
    },
  );

  // POST /api/system/google-drive/exchange-code
  app.post<{ Body: unknown }>(
    '/api/system/google-drive/exchange-code',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getRequestUser(request);
      await assertCan(user, 'admin:system');

      const parsed = exchangeCodeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid code exchange parameters.',
          details: parsed.error.issues.map((i) => i.message),
        });
      }

      const protocol = request.protocol || 'http';
      const host = request.headers.host || 'localhost:3001';
      const defaultRedirectUri = `${protocol}://${host}/api/system/google-drive/callback`;
      const redirectUri = parsed.data.redirectUri || defaultRedirectUri;

      try {
        const config = await exchangeAuthCode({
          code: parsed.data.code,
          redirectUri,
          clientId: parsed.data.clientId,
          clientSecret: parsed.data.clientSecret,
          folderId: parsed.data.folderId,
        });

        return reply.send({ message: 'Google Drive connected successfully.', config });
      } catch (err) {
        return reply.status(400).send({
          code: 'GOOGLE_DRIVE_AUTH_FAILED',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // PUT /api/system/google-drive
  app.put<{ Body: unknown }>(
    '/api/system/google-drive',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getRequestUser(request);
      await assertCan(user, 'admin:system');

      const parsed = driveConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid Google Drive configuration.',
          details: parsed.error.issues.map((i) => i.message),
        });
      }

      try {
        const config = await saveDriveConfig(parsed.data);
        return reply.send({ message: 'Google Drive connected successfully.', config });
      } catch (err) {
        return reply.status(400).send({
          code: 'GOOGLE_DRIVE_AUTH_FAILED',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // POST /api/system/google-drive/test
  app.post('/api/system/google-drive/test', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = getRequestUser(request);
    await assertCan(user, 'admin:system');

    const result = await testGoogleDriveConnection();
    if (!result.ok) {
      return reply.status(400).send({
        code: 'CONNECTION_FAILED',
        message: result.error || 'Failed to connect to Google Drive.',
      });
    }

    return { message: 'Google Drive connection successful.', details: result };
  });

  // DELETE /api/system/google-drive
  app.delete('/api/system/google-drive', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    await assertCan(user, 'admin:system');

    deleteDriveConfig();
    return { message: 'Google Drive disconnected.' };
  });

  // POST /api/system/backups (full disaster recovery backup)
  app.post<{ Body: unknown }>(
    '/api/system/backups',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getRequestUser(request);
      await assertCan(user, 'admin:system');

      const parsed = systemBackupSchema.safeParse(request.body || {});
      const detail = await createFullSystemBackup(user.id, parsed.data || {}, request.ip);
      return reply.status(201).send(detail);
    },
  );

  // GET /api/system/backups
  app.get('/api/system/backups', { preHandler: [requireAuth] }, async (request) => {
    const user = getRequestUser(request);
    await assertCan(user, 'admin:system');

    const list = await listSystemBackups();
    return { backups: list };
  });

  // GET /api/system/backups/:filename/download
  app.get<{ Params: { filename: string } }>(
    '/api/system/backups/:filename/download',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = getRequestUser(request);
      await assertCan(user, 'admin:system');

      const { filename } = request.params;
      // Sanitize filename to prevent directory traversal
      if (!/^vaultrealm_full_system_[0-9]+_[a-zA-Z0-9_-]+\.tar\.gz$/.test(filename)) {
        return reply.status(400).send({ code: 'INVALID_FILENAME', message: 'Invalid backup filename.' });
      }

      const filePath = path.join(getBackupsDir(), filename);
      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'System backup file not found.' });
      }

      const stream = fs.createReadStream(filePath);
      reply.header('Content-Type', 'application/gzip');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(stream);
    },
  );
}

