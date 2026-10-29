import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, cleanupTestApp, registerAdmin } from './helpers.js';
import { getMinecraftJavaVersions, getTemplateVersions } from '../src/servers/versions.js';

describe('Template Versions Provider', () => {
  let app: FastifyInstance;
  let adminCookie: string;

  beforeEach(async () => {
    app = await buildTestApp();

    const { cookies } = await registerAdmin(app);
    adminCookie = cookies['vr_session']!;
  });

  afterEach(() => {
    cleanupTestApp();
  });

  it('fetches Minecraft Java versions including LATEST at top', async () => {
    const result = await getMinecraftJavaVersions();
    expect(result).toBeDefined();
    expect(result.recommended).toBe('LATEST');
    expect(result.versions.length).toBeGreaterThan(5);
    expect(result.versions[0]).toBe('LATEST');
    expect(result.source).toBeDefined();
  });

  it('provides Bedrock channel versions for minecraft-bedrock', async () => {
    const result = await getTemplateVersions('minecraft-bedrock');
    expect(result).toBeDefined();
    expect(result.versions).toContain('LATEST');
    expect(result.versions).toContain('PREVIEW');
  });

  it('provides fallback channel for non-versioned game templates', async () => {
    const result = await getTemplateVersions('valheim');
    expect(result).toBeDefined();
    expect(result.versions).toEqual(['LATEST']);
  });

  it('GET /api/templates/:templateId/versions returns versions via API', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/templates/minecraft-java/versions',
      cookies: { vr_session: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.versions).toBeDefined();
    expect(body.versions[0]).toBe('LATEST');
    expect(body.recommended).toBe('LATEST');
  });
});

