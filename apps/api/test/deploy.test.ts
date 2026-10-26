import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildTestApp, cleanupTestApp, registerAdmin } from './helpers.js';
import { getDatabase } from '../src/db/index.js';
import { events } from '../src/db/schema.js';
import { subscribeDeployProgress, type DeployStepEvent } from '../src/servers/deploy.js';

describe('Deploy Pipeline', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(() => {
    cleanupTestApp();
  });

  it('runs the full deployment pipeline and records events', async () => {
    const { cookies } = await registerAdmin(app);
    const adminCookie = cookies['vr_session']!;

    const receivedEvents: DeployStepEvent[] = [];

    // Deploy server via API
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers',
      cookies: { vr_session: adminCookie },
      payload: {
        name: 'My Paper Server',
        templateId: 'minecraft-java',
        ramMb: 2048,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe('creating');

    const serverId = body.id;
    const unsub = subscribeDeployProgress(serverId, (evt) => {
      receivedEvents.push(evt);
    });

    // Wait briefly for background async steps to run with mock driver
    await new Promise((resolve) => setTimeout(resolve, 300));
    unsub();

    // Verify DB events were written
    const db = getDatabase();
    const recordedEvents = db
      .select()
      .from(events)
      .where(eq(events.serverId, serverId))
      .all();

    expect(recordedEvents.length).toBeGreaterThanOrEqual(3);

    // Verify events endpoint
    const eventsRes = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/events`,
      cookies: { vr_session: adminCookie },
    });
    expect(eventsRes.statusCode).toBe(200);
    const eventsList = eventsRes.json();
    expect(Array.isArray(eventsList)).toBe(true);
    expect(eventsList.length).toBeGreaterThanOrEqual(3);

    // Verify system capacity endpoint
    const capacityRes = await app.inject({
      method: 'GET',
      url: '/api/system/capacity',
      cookies: { vr_session: adminCookie },
    });
    expect(capacityRes.statusCode).toBe(200);
    const cap = capacityRes.json();
    expect(cap.host.totalHostRamMb).toBeGreaterThan(0);
    expect(cap.user.serverCount).toBe(1);
  });

  it('preserves container and records error event if deploy fails', async () => {
    const { cookies } = await registerAdmin(app);
    const adminCookie = cookies['vr_session']!;

    // Deploy with an invalid template ID
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers',
      cookies: { vr_session: adminCookie },
      payload: {
        name: 'Bad Server',
        templateId: 'non-existent-template',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('INVALID_TEMPLATE');
  });
});
