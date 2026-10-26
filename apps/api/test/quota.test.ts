import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildTestApp, cleanupTestApp, registerAdmin } from './helpers.js';
import { getDatabase } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import {
  getUserQuotaUsage,
  getHostCapacityStatus,
  assertQuotaAvailable,
  QuotaExceededError,
} from '../src/servers/quota.js';

describe('Quota Engine', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(() => {
    cleanupTestApp();
  });

  it('calculates user quota usage accurately', async () => {
    const { response } = await registerAdmin(app);
    const user = response.json();

    const usage = getUserQuotaUsage(user.id);
    expect(usage.serverCount).toBe(0);
    expect(usage.quotaServers).toBe(3);
    expect(usage.ramMb).toBe(0);
    expect(usage.quotaRamMb).toBe(8192);
  });

  it('blocks deployment when user server count quota is reached', async () => {
    const { response, cookies } = await registerAdmin(app);
    const user = response.json();
    const adminCookie = cookies['vr_session']!;
    const db = getDatabase();

    // Set user quota to 1 server
    db.update(users).set({ quotaServers: 1 }).where(eq(users.id, user.id)).run();

    // Should succeed for first server
    expect(() => assertQuotaAvailable(user.id, 1024)).not.toThrow();

    // Create 1 server
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/servers',
      cookies: { vr_session: adminCookie },
      payload: { name: 'Server 1', templateId: 'minecraft-java' },
    });
    expect(createRes.statusCode).toBe(201);

    // Second server should be blocked by quota
    expect(() => assertQuotaAvailable(user.id, 1024)).toThrow(QuotaExceededError);
  });

  it('blocks deployment when user RAM quota is exceeded', async () => {
    const { response } = await registerAdmin(app);
    const user = response.json();
    const db = getDatabase();

    // Set RAM quota to 2048 MB
    db.update(users).set({ quotaRamMb: 2048 }).where(eq(users.id, user.id)).run();

    // Attempting to deploy Palworld (default 12288 MB) should fail with clear message
    expect(() => assertQuotaAvailable(user.id, 12288)).toThrowError(
      /RAM quota exceeded\. You have 2048 MB remaining/,
    );
  });

  it('reports host RAM capacity and budget percentage', () => {
    const host = getHostCapacityStatus();
    expect(host.totalHostRamMb).toBeGreaterThan(0);
    expect(host.budgetPct).toBe(85);
    expect(host.budgetRamMb).toBeGreaterThan(0);
    expect(host.availableBudgetRamMb).toBeLessThanOrEqual(host.budgetRamMb);
  });
});
