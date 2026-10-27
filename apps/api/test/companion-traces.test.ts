import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { buildTestApp, registerAdmin, cleanupTestApp } from './helpers.js';
import { getDatabase } from '../src/db/index.js';
import { servers, llmEndpoints, bots, botUsage, botTraces } from '../src/db/schema.js';

describe('Phase 6d — Companion Usage, Traces & Microsoft Device-Code Routes', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let testServerId: string;
  let testBotId: string;

  beforeEach(async () => {
    app = await buildTestApp();
    const adminRes = await registerAdmin(app);
    adminCookie = adminRes.cookies['vr_session']!;
    const userId = adminRes.response.json().id;

    const db = getDatabase();

    // 1. Create LLM endpoint
    const endpointId = nanoid();
    db.insert(llmEndpoints)
      .values({
        id: endpointId,
        ownerId: userId,
        scope: 'user',
        name: 'OpenAI Test',
        baseUrl: 'https://api.openai.com/v1',
        supportsTools: true,
      })
      .run();

    // 2. Create server
    testServerId = nanoid();
    db.insert(servers)
      .values({
        id: testServerId,
        ownerId: userId,
        name: '6d Server',
        templateId: 'paper',
        status: 'running',
        ramMb: 1024,
      })
      .run();

    // 3. Create companion bot
    testBotId = nanoid();
    db.insert(bots)
      .values({
        id: testBotId,
        serverId: testServerId,
        endpointId,
        name: 'Buddy',
        persona: 'helpful buddy',
        status: 'online',
        dailyTokenBudget: 100000,
        rpmLimit: 15,
      })
      .run();
  });

  afterEach(async () => {
    await cleanupTestApp(app);
  });

  it('GET /api/servers/:id/companion/bot/usage returns accurate daily token usage and metrics', async () => {
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);

    // Record usage
    db.insert(botUsage)
      .values({
        botId: testBotId,
        day: today,
        promptTokens: 5000,
        completionTokens: 1000,
        requests: 12,
      })
      .run();

    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${testServerId}/companion/bot/usage`,
      cookies: { vr_session: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalTokens).toBe(6000);
    expect(body.promptTokens).toBe(5000);
    expect(body.completionTokens).toBe(1000);
    expect(body.requests).toBe(12);
    expect(body.dailyBudget).toBe(100000);
    expect(body.remainingTokens).toBe(94000);
    expect(body.percentUsed).toBe(6);
    expect(body.estimatedCostUsd).toBeCloseTo(0.012, 4);
    expect(body.rpmLimit).toBe(15);
  });

  it('GET /api/servers/:id/companion/bot/traces returns recent formatted traces', async () => {
    const db = getDatabase();

    // Record sample trace
    db.insert(botTraces)
      .values({
        id: nanoid(),
        botId: testBotId,
        requestJson: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
        responseJson: JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
        latencyMs: 350,
        status: 'success',
      })
      .run();

    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${testServerId}/companion/bot/traces`,
      cookies: { vr_session: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.traces)).toBe(true);
    expect(body.traces.length).toBe(1);
    expect(body.traces[0].status).toBe('success');
    expect(body.traces[0].latencyMs).toBe(350);
    expect(body.traces[0].request.messages[0].content).toBe('hello');
    expect(body.traces[0].response.choices[0].message.content).toBe('hi');
  });

  it('POST /api/servers/:id/companion/bot/device-code initiates Microsoft auth flow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${testServerId}/companion/bot/device-code`,
      cookies: { vr_session: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.userCode).toMatch(/^VRMC-[A-Z0-9]{4}$/);
    expect(body.verificationUri).toBe('https://microsoft.com/link');
    expect(body.expiresIn).toBe(900);
  });
});
