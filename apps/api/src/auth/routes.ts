/**
 * Auth routes — register, login, logout, me, invites.
 *
 * Registration rules:
 *   - First user ever → becomes admin, no invite needed
 *   - All subsequent users → require a valid invite code
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, gt, or, isNull, count } from 'drizzle-orm';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { getDatabase } from '../db/index.js';
import { users, invites } from '../db/schema.js';
import { createToken, COOKIE_NAME, getSessionCookieOptions } from './sessions.js';
import { requireAuth, getRequestUser } from './middleware.js';
import { assertCan } from './rbac.js';
import { writeAudit } from '../audit/log.js';
import { loginLimiter, registerLimiter } from './rate-limit.js';
import { validate } from '../validation.js';

// ── Validation schemas ───────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(32, 'Username must be at most 32 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, hyphens and underscores'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  login: z.string().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

const createInviteSchema = z.object({
  maxUses: z.number().int().min(1).max(100).default(1),
  expiresInHours: z.number().int().min(1).max(720).optional(), // max 30 days
  quotaPreset: z.string().optional(),
});

// ── Route registration ───────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/auth/register ────────────────────────────────────────────────
  app.post(
    '/api/auth/register',
    { preHandler: [registerLimiter] },
    async (request, reply) => {
      const parsed = validate(registerSchema, request.body, reply);
      if (!parsed.success) return;
      const body = parsed.data;
      const db = getDatabase();

      // Check if this is the first user (→ admin, no invite needed)
      const [countResult] = db.select({ value: count() }).from(users).all();
      const userCount = countResult?.value ?? 0;
      const isFirstUser = userCount === 0;

      // ── Invite validation (required for non-first users) ─────────────────
      if (!isFirstUser) {
        if (!body.inviteCode) {
          return reply.status(400).send({
            code: 'INVITE_REQUIRED',
            message: 'An invite code is required to register.',
          });
        }

        const matchingInvites = db
          .select()
          .from(invites)
          .where(
            and(
              eq(invites.code, body.inviteCode),
              or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date().toISOString())),
            ),
          )
          .all();

        const invite = matchingInvites[0];

        if (!invite) {
          return reply.status(400).send({
            code: 'INVALID_INVITE',
            message: 'Invalid or expired invite code.',
          });
        }

        if (invite.uses >= invite.maxUses) {
          return reply.status(400).send({
            code: 'INVITE_EXHAUSTED',
            message: 'This invite code has already been used the maximum number of times.',
          });
        }

        // Increment invite usage
        db.update(invites)
          .set({ uses: invite.uses + 1 })
          .where(eq(invites.id, invite.id))
          .run();
      }

      // ── Check for duplicates ───────────────────────────────────────────────
      const existingEmail = db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.email.toLowerCase()))
        .all();
      if (existingEmail.length > 0) {
        return reply.status(409).send({
          code: 'EMAIL_EXISTS',
          message: 'An account with this email already exists.',
        });
      }

      const existingUsername = db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, body.username.toLowerCase()))
        .all();
      if (existingUsername.length > 0) {
        return reply.status(409).send({
          code: 'USERNAME_EXISTS',
          message: 'This username is already taken.',
        });
      }

      // ── Create user ────────────────────────────────────────────────────────
      const passwordHash = await argon2.hash(body.password, {
        type: argon2.argon2id,
        memoryCost: 65536, // 64 MB
        timeCost: 3,
        parallelism: 4,
      });

      const userId = nanoid();
      const role = isFirstUser ? 'admin' : 'user';

      db.insert(users)
        .values({
          id: userId,
          email: body.email.toLowerCase(),
          username: body.username.toLowerCase(),
          passwordHash,
          role,
        })
        .run();

      writeAudit({
        userId,
        action: 'auth.register',
        ip: request.ip,
        data: { username: body.username, isFirstUser },
      });

      // ── Auto-login ─────────────────────────────────────────────────────────
      const token = createToken(userId, role);
      reply.setCookie(COOKIE_NAME, token, getSessionCookieOptions(request));

      return reply.status(201).send({
        id: userId,
        email: body.email.toLowerCase(),
        username: body.username.toLowerCase(),
        role,
        token,
      });
    },
  );

  // ── POST /api/auth/login ───────────────────────────────────────────────────
  app.post(
    '/api/auth/login',
    { preHandler: [loginLimiter] },
    async (request, reply) => {
      const parsed = validate(loginSchema, request.body, reply);
      if (!parsed.success) return;
      const body = parsed.data;
      const db = getDatabase();

      // Find user by email or username
      const matchingUsers = db
        .select()
        .from(users)
        .where(
          or(
            eq(users.email, body.login.toLowerCase()),
            eq(users.username, body.login.toLowerCase()),
          ),
        )
        .all();

      const user = matchingUsers[0];

      if (!user) {
        return reply.status(401).send({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email/username or password.',
        });
      }

      if (user.disabled) {
        return reply.status(403).send({
          code: 'ACCOUNT_DISABLED',
          message: 'Your account has been disabled. Contact an administrator.',
        });
      }

      // Verify password
      const validPassword = await argon2.verify(user.passwordHash, body.password);
      if (!validPassword) {
        return reply.status(401).send({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email/username or password.',
        });
      }

      writeAudit({
        userId: user.id,
        action: 'auth.login',
        ip: request.ip,
      });

      const token = createToken(user.id, user.role);
      reply.setCookie(COOKIE_NAME, token, getSessionCookieOptions(request));

      return {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        token,
      };
    },
  );

  // ── POST /api/auth/logout ──────────────────────────────────────────────────
  app.post('/api/auth/logout', async (request, reply) => {
    reply.setCookie(COOKIE_NAME, '', getSessionCookieOptions(request, true));
    return { message: 'Logged out.' };
  });

  // ── GET /api/me ────────────────────────────────────────────────────────────
  app.get(
    '/api/me',
    { preHandler: [requireAuth] },
    async (request) => {
      const authUser = getRequestUser(request);
      const db = getDatabase();

      const results = db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          role: users.role,
          quotaServers: users.quotaServers,
          quotaRamMb: users.quotaRamMb,
          quotaCpu: users.quotaCpu,
          quotaDiskMb: users.quotaDiskMb,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, authUser.id))
        .all();

      const user = results[0];

      if (!user) {
        const error = new Error('User not found.') as Error & { statusCode: number; code: string };
        error.statusCode = 404;
        error.code = 'USER_NOT_FOUND';
        throw error;
      }

      return user;
    },
  );

  // ── GET /api/auth/setup-status ─────────────────────────────────────────────
  // Public endpoint: tells the frontend whether the panel has been set up
  app.get('/api/auth/setup-status', async () => {
    const db = getDatabase();
    const [countResult] = db.select({ value: count() }).from(users).all();
    const userCount = countResult?.value ?? 0;
    return {
      needsSetup: userCount === 0,
    };
  });

  // ── POST /api/admin/invites ────────────────────────────────────────────────
  app.post(
    '/api/admin/invites',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const authUser = getRequestUser(request);
      await assertCan(authUser, 'admin:invites');

      const parsed = validate(createInviteSchema, request.body, reply);
      if (!parsed.success) return;
      const body = parsed.data;
      const db = getDatabase();

      const code = nanoid(12); // short, readable code
      const id = nanoid();

      const expiresAt = body.expiresInHours
        ? new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000).toISOString()
        : null;

      db.insert(invites)
        .values({
          id,
          code,
          createdBy: authUser.id,
          maxUses: body.maxUses,
          expiresAt,
          quotaPreset: body.quotaPreset ?? null,
        })
        .run();

      writeAudit({
        userId: authUser.id,
        action: 'invites.create',
        target: id,
        ip: request.ip,
        data: { code, maxUses: body.maxUses },
      });

      return reply.status(201).send({
        id,
        code,
        maxUses: body.maxUses,
        uses: 0,
        expiresAt,
      });
    },
  );

  // ── GET /api/admin/invites ─────────────────────────────────────────────────
  app.get(
    '/api/admin/invites',
    { preHandler: [requireAuth] },
    async (request) => {
      const authUser = getRequestUser(request);
      await assertCan(authUser, 'admin:invites');

      const db = getDatabase();
      return db.select().from(invites).all();
    },
  );

  // ── DELETE /api/admin/invites/:id ──────────────────────────────────────────
  app.delete(
    '/api/admin/invites/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const authUser = getRequestUser(request);
      await assertCan(authUser, 'admin:invites');

      const { id } = request.params as { id: string };
      const db = getDatabase();

      const results = db.select().from(invites).where(eq(invites.id, id)).all();
      const invite = results[0];

      if (!invite) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Invite not found.',
        });
      }

      db.delete(invites).where(eq(invites.id, id)).run();

      writeAudit({
        userId: authUser.id,
        action: 'invites.delete',
        target: id,
        ip: request.ip,
      });

      return { message: 'Invite deleted.' };
    },
  );
}
