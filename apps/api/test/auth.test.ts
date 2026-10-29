import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp,
  cleanupTestApp,
  registerAdmin,
  registerUser,
  loginUser,
  createInvite,
} from './helpers.js';

describe('Auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(() => {
    cleanupTestApp();
  });

  // ── Setup status ─────────────────────────────────────────────────────────
  describe('GET /api/auth/setup-status', () => {
    it('returns needsSetup: true when no users exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/setup-status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ needsSetup: true });
    });

    it('returns needsSetup: false after first user', async () => {
      await registerAdmin(app);
      const res = await app.inject({ method: 'GET', url: '/api/auth/setup-status' });
      expect(res.json()).toEqual({ needsSetup: false });
    });
  });

  // ── Registration ─────────────────────────────────────────────────────────
  describe('POST /api/auth/register', () => {
    it('first user becomes admin without invite', async () => {
      const { response } = await registerAdmin(app);
      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.role).toBe('admin');
      expect(body.email).toBe('admin@test.com');
      expect(body.username).toBe('admin');
    });

    it('sets httpOnly session cookie on register', async () => {
      const { response } = await registerAdmin(app);
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(String(setCookie)).toContain('vr_session=');
      expect(String(setCookie)).toContain('HttpOnly');
    });

    it('rejects second user without invite code', async () => {
      await registerAdmin(app);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'user@test.com',
          username: 'testuser',
          password: 'password123!',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVITE_REQUIRED');
    });

    it('registers second user with valid invite', async () => {
      const { cookies: adminCookies } = await registerAdmin(app);
      const inviteRes = await createInvite(app, adminCookies['vr_session']!);
      const inviteCode = inviteRes.json().code;

      const { response } = await registerUser(app, inviteCode);
      expect(response.statusCode).toBe(201);
      expect(response.json().role).toBe('user');
    });

    it('rejects expired invite', async () => {
      const { cookies: adminCookies } = await registerAdmin(app);

      // Create an invite that expires immediately (in the past)
      const inviteRes = await createInvite(app, adminCookies['vr_session']!);
      const inviteCode = inviteRes.json().code;

      // Manually expire it
      const { getDatabase } = await import('../src/db/index.js');
      const { invites } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const db = getDatabase();
      db.update(invites)
        .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
        .where(eq(invites.code, inviteCode))
        .run();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'user2@test.com',
          username: 'user2',
          password: 'password123!',
          inviteCode,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_INVITE');
    });

    it('rejects exhausted invite', async () => {
      const { cookies: adminCookies } = await registerAdmin(app);
      const inviteRes = await createInvite(app, adminCookies['vr_session']!, { maxUses: 1 });
      const inviteCode = inviteRes.json().code;

      // Use the invite
      await registerUser(app, inviteCode);

      // Try to use again
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'user3@test.com',
          username: 'user3',
          password: 'password123!',
          inviteCode,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVITE_EXHAUSTED');
    });

    it('rejects duplicate email', async () => {
      await registerAdmin(app);

      const { cookies: adminCookies } = await loginUser(app, 'admin');
      const inviteRes = await createInvite(app, adminCookies['vr_session']!);
      const inviteCode = inviteRes.json().code;

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'admin@test.com',
          username: 'different',
          password: 'password123!',
          inviteCode,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('EMAIL_EXISTS');
    });

    it('rejects duplicate username', async () => {
      await registerAdmin(app);

      const { cookies: adminCookies } = await loginUser(app, 'admin');
      const inviteRes = await createInvite(app, adminCookies['vr_session']!);
      const inviteCode = inviteRes.json().code;

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'different@test.com',
          username: 'admin',
          password: 'password123!',
          inviteCode,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('USERNAME_EXISTS');
    });

    it('validates email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'not-an-email',
          username: 'test',
          password: 'password123!',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects short password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'test@test.com',
          username: 'test',
          password: 'short',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── Login ────────────────────────────────────────────────────────────────
  describe('POST /api/auth/login', () => {
    it('logs in with email', async () => {
      await registerAdmin(app);

      const { response } = await loginUser(app, 'admin@test.com');
      expect(response.statusCode).toBe(200);
      expect(response.json().username).toBe('admin');
    });

    it('logs in with username', async () => {
      await registerAdmin(app);

      const { response } = await loginUser(app, 'admin');
      expect(response.statusCode).toBe(200);
      expect(response.json().role).toBe('admin');
    });

    it('sets session cookie on login', async () => {
      await registerAdmin(app);

      const { response } = await loginUser(app, 'admin');
      expect(String(response.headers['set-cookie'])).toContain('vr_session=');
    });

    it('rejects wrong password', async () => {
      await registerAdmin(app);

      const { response } = await loginUser(app, 'admin', 'wrongpassword');
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects non-existent user', async () => {
      const { response } = await loginUser(app, 'nobody');
      expect(response.statusCode).toBe(401);
    });

    it('rejects disabled user', async () => {
      await registerAdmin(app);

      // Disable the admin account directly
      const { getDatabase } = await import('../src/db/index.js');
      const { users } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const db = getDatabase();
      db.update(users)
        .set({ disabled: true })
        .where(eq(users.username, 'admin'))
        .run();

      const { response } = await loginUser(app, 'admin');
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('ACCOUNT_DISABLED');
    });
  });

  // ── Logout ───────────────────────────────────────────────────────────────
  describe('POST /api/auth/logout', () => {
    it('clears session cookie', async () => {
      await registerAdmin(app);
      const { cookies: adminCookies } = await loginUser(app, 'admin');

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        cookies: { vr_session: adminCookies['vr_session']! },
      });

      expect(res.statusCode).toBe(200);
      // Cookie should be cleared (max-age=0)
      const setCookie = String(res.headers['set-cookie']);
      expect(setCookie).toContain('vr_session=');
      expect(setCookie).toMatch(/Max-Age=0/i);
    });
  });

  // ── Me ───────────────────────────────────────────────────────────────────
  describe('GET /api/me', () => {
    it('returns authenticated user profile', async () => {
      const { cookies, response } = await registerAdmin(app);
      const token = response.json().token;
      expect(token).toBeDefined();

      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        cookies: { vr_session: cookies['vr_session']! },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.email).toBe('admin@test.com');
      expect(body.username).toBe('admin');
      expect(body.role).toBe('admin');
      expect(body.quotaServers).toBeDefined();
      // Should never return password hash
      expect(body.passwordHash).toBeUndefined();
    });

    it('authenticates via Authorization Bearer header without cookies', async () => {
      const { response } = await registerAdmin(app);
      const token = response.json().token;
      expect(token).toBeDefined();

      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().username).toBe('admin');
    });

    it('infers secure cookie attribute only when request is HTTPS', async () => {
      await registerAdmin(app);

      // Plain HTTP request (no HTTPS headers) -> no Secure attribute in cookie
      const httpRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          login: 'admin',
          password: 'password123!',
        },
      });
      expect(httpRes.statusCode).toBe(200);
      const httpCookie = String(httpRes.headers['set-cookie']);
      expect(httpCookie).not.toContain('Secure');

      // HTTPS request with X-Forwarded-Proto: https -> sets Secure attribute in cookie
      const httpsRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'x-forwarded-proto': 'https',
        },
        payload: {
          login: 'admin',
          password: 'password123!',
        },
      });
      expect(httpsRes.statusCode).toBe(200);
      const httpsCookie = String(httpsRes.headers['set-cookie']);
      expect(httpsCookie).toContain('Secure');
    });

    it('returns 401 without session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/me' });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('returns 401 with invalid session token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        cookies: { vr_session: 'invalid.token.here' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Invites ──────────────────────────────────────────────────────────────
  describe('Invite management', () => {
    it('admin can create invites', async () => {
      const { cookies: adminCookies } = await registerAdmin(app);

      const res = await createInvite(app, adminCookies['vr_session']!);
      expect(res.statusCode).toBe(201);

      const body = res.json();
      expect(body.code).toBeTruthy();
      expect(body.maxUses).toBe(10);
      expect(body.uses).toBe(0);
    });

    it('admin can list invites', async () => {
      const { cookies: adminCookies } = await registerAdmin(app);
      await createInvite(app, adminCookies['vr_session']!);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/invites',
        cookies: { vr_session: adminCookies['vr_session']! },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
    });

    it('admin can delete invites', async () => {
      const { cookies: adminCookies } = await registerAdmin(app);
      const inviteRes = await createInvite(app, adminCookies['vr_session']!);
      const inviteId = inviteRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/invites/${inviteId}`,
        cookies: { vr_session: adminCookies['vr_session']! },
      });

      expect(res.statusCode).toBe(200);
    });

    it('regular user cannot create invites', async () => {
      const { cookies: adminCookies } = await registerAdmin(app);
      const inviteRes = await createInvite(app, adminCookies['vr_session']!);
      const inviteCode = inviteRes.json().code;

      const { cookies: userCookies } = await registerUser(app, inviteCode);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/invites',
        payload: { maxUses: 1 },
        cookies: { vr_session: userCookies['vr_session']! },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it('regular user cannot list invites', async () => {
      const { cookies: adminCookies } = await registerAdmin(app);
      const inviteRes = await createInvite(app, adminCookies['vr_session']!);
      const inviteCode = inviteRes.json().code;

      const { cookies: userCookies } = await registerUser(app, inviteCode);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/invites',
        cookies: { vr_session: userCookies['vr_session']! },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
