import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerStatic, isSpaRoute, resolveWebDistPath } from '../src/static.js';

describe('Static Frontend & SPA Fallback', () => {
  describe('isSpaRoute helper', () => {
    it('allows client GET/HEAD routes for SPA fallback', () => {
      expect(isSpaRoute('GET', '/')).toBe(true);
      expect(isSpaRoute('GET', '/servers')).toBe(true);
      expect(isSpaRoute('GET', '/servers/srv-123')).toBe(true);
      expect(isSpaRoute('GET', '/login')).toBe(true);
      expect(isSpaRoute('HEAD', '/dashboard')).toBe(true);
      expect(isSpaRoute('GET', '/dashboard?tab=overview')).toBe(true);
    });

    it('rejects non-GET/HEAD methods', () => {
      expect(isSpaRoute('POST', '/servers')).toBe(false);
      expect(isSpaRoute('DELETE', '/servers/123')).toBe(false);
      expect(isSpaRoute('PUT', '/config')).toBe(false);
    });

    it('rejects API, WebSocket, internal and health routes', () => {
      expect(isSpaRoute('GET', '/api/auth/me')).toBe(false);
      expect(isSpaRoute('GET', '/api/servers')).toBe(false);
      expect(isSpaRoute('GET', '/ws')).toBe(false);
      expect(isSpaRoute('GET', '/internal/llm/chat')).toBe(false);
      expect(isSpaRoute('GET', '/healthz')).toBe(false);
    });

    it('rejects asset requests that have file extensions', () => {
      expect(isSpaRoute('GET', '/assets/index-BZ8AA7PV.css')).toBe(false);
      expect(isSpaRoute('GET', '/assets/index-Dabz4C0r.js')).toBe(false);
      expect(isSpaRoute('GET', '/favicon.ico')).toBe(false);
      expect(isSpaRoute('GET', '/VR2.jpg')).toBe(false);
      expect(isSpaRoute('GET', '/manifest.json')).toBe(false);
      expect(isSpaRoute('GET', '/bundle.js.map')).toBe(false);
    });
  });

  describe('resolveWebDistPath helper', () => {
    it('returns custom directory if it exists', () => {
      const temp = mkdtempSync(join(tmpdir(), 'vr-dist-test-'));
      try {
        expect(resolveWebDistPath(temp)).toBe(temp);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });

    it('returns null if given a nonexistent custom directory and no fallback exists', () => {
      const originalEnv = process.env.WEB_DIST_DIR;
      delete process.env.WEB_DIST_DIR;
      try {
        const result = resolveWebDistPath('nonexistent-path-12345');
        // If web/dist exists in the workspace, it falls back to it, otherwise null
        if (result) {
          expect(result).toContain('dist');
        } else {
          expect(result).toBeNull();
        }
      } finally {
        if (originalEnv) process.env.WEB_DIST_DIR = originalEnv;
      }
    });
  });

  describe('Fastify static serving & SPA fallback integration', () => {
    let tempDir: string;
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'vr-static-app-'));
      writeFileSync(join(tempDir, 'index.html'), '<!DOCTYPE html><html><body>VaultRealm App</body></html>');
      writeFileSync(join(tempDir, 'logo.png'), 'fake-image-bytes');

      app = Fastify({ logger: false });

      // Add a test API endpoint
      app.get('/api/test', async () => ({ ok: true }));

      const hasStatic = await registerStatic(app, tempDir);
      expect(hasStatic).toBe(true);

      app.setNotFoundHandler((request, reply) => {
        if (hasStatic && isSpaRoute(request.method, request.url)) {
          return reply.sendFile('index.html');
        }

        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Route not found',
        });
      });

      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('serves index.html on root /', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('VaultRealm App');
    });

    it('serves static files that exist on disk', async () => {
      const res = await app.inject({ method: 'GET', url: '/logo.png' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('fake-image-bytes');
    });

    it('falls back to index.html for SPA client routes', async () => {
      const res = await app.inject({ method: 'GET', url: '/servers/srv-1' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('VaultRealm App');
    });

    it('returns 404 JSON for missing static assets with file extensions', async () => {
      const res = await app.inject({ method: 'GET', url: '/assets/missing.js' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.json()).toEqual({
        code: 'NOT_FOUND',
        message: 'Route not found',
      });
    });

    it('returns 404 JSON for nonexistent API routes', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/nonexistent' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.json()).toEqual({
        code: 'NOT_FOUND',
        message: 'Route not found',
      });
    });

    it('returns 404 JSON for non-GET/HEAD requests to unmatched routes', async () => {
      const res = await app.inject({ method: 'POST', url: '/servers' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        code: 'NOT_FOUND',
        message: 'Route not found',
      });
    });

    it('still executes registered API endpoints', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/test' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });
});

