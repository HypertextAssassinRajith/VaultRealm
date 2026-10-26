import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp,
  cleanupTestApp,
  registerAdmin,
  registerUser,
  createInvite,
} from './helpers.js';
import { can } from '../src/auth/rbac.js';
import type { AuthUser } from '../src/auth/rbac.js';
import { getDatabase } from '../src/db/index.js';
import { servers, serverMembers, users } from '../src/db/schema.js';
import { nanoid } from 'nanoid';
import argon2 from 'argon2';

describe('RBAC — can() function', () => {
  let _app: FastifyInstance;

  beforeEach(async () => {
    _app = await buildTestApp();
  });

  afterEach(() => {
    cleanupTestApp();
  });

  // Helper to create a user directly in DB
  async function createTestUser(id: string, username: string): Promise<string> {
    const db = getDatabase();
    const hash = await argon2.hash('testpass');
    db.insert(users)
      .values({
        id,
        email: `${username}@test.com`,
        username,
        passwordHash: hash,
      })
      .run();
    return id;
  }

  // Helper to create a server record directly in DB (owner must exist first!)
  function createTestServer(ownerId: string): string {
    const db = getDatabase();
    const serverId = nanoid();
    db.insert(servers)
      .values({
        id: serverId,
        ownerId,
        name: 'Test Server',
        templateId: 'minecraft-java',
        ramMb: 2048,
      })
      .run();
    return serverId;
  }

  function addServerMember(serverId: string, userId: string, permissions: Record<string, boolean>) {
    const db = getDatabase();
    db.insert(serverMembers)
      .values({
        serverId,
        userId,
        permissionsJson: JSON.stringify(permissions),
      })
      .run();
  }

  describe('admin role', () => {
    it('admin can do anything', async () => {
      const admin: AuthUser = { id: 'admin-1', role: 'admin' };

      expect(await can(admin, 'server:list')).toBe(true);
      expect(await can(admin, 'server:create')).toBe(true);
      expect(await can(admin, 'admin:users')).toBe(true);
      expect(await can(admin, 'admin:system')).toBe(true);
      expect(await can(admin, 'admin:invites')).toBe(true);
      expect(await can(admin, 'admin:audit')).toBe(true);
      expect(await can(admin, 'server:delete', 'any-server')).toBe(true);
    });
  });

  describe('regular user', () => {
    it('user can list and create servers', async () => {
      const user: AuthUser = { id: 'user-1', role: 'user' };

      expect(await can(user, 'server:list')).toBe(true);
      expect(await can(user, 'server:create')).toBe(true);
    });

    it('user cannot access admin routes', async () => {
      const user: AuthUser = { id: 'user-1', role: 'user' };

      expect(await can(user, 'admin:users')).toBe(false);
      expect(await can(user, 'admin:system')).toBe(false);
      expect(await can(user, 'admin:invites')).toBe(false);
      expect(await can(user, 'admin:audit')).toBe(false);
      expect(await can(user, 'auth:manage-invites')).toBe(false);
    });
  });

  describe('server ownership', () => {
    it('owner can perform all server actions', async () => {
      const ownerId = await createTestUser('owner-1', 'owner1');
      const serverId = createTestServer(ownerId);

      const owner: AuthUser = { id: ownerId, role: 'user' };

      expect(await can(owner, 'server:view', serverId)).toBe(true);
      expect(await can(owner, 'server:power', serverId)).toBe(true);
      expect(await can(owner, 'server:delete', serverId)).toBe(true);
      expect(await can(owner, 'server:console', serverId)).toBe(true);
      expect(await can(owner, 'server:files', serverId)).toBe(true);
      expect(await can(owner, 'server:backups', serverId)).toBe(true);
      expect(await can(owner, 'server:settings', serverId)).toBe(true);
      expect(await can(owner, 'server:members', serverId)).toBe(true);
    });
  });

  describe('sub-user permissions', () => {
    it('member with console permission can view and use console', async () => {
      const ownerId = await createTestUser('owner-2', 'owner2');
      const memberId = await createTestUser('member-1', 'member1');
      const serverId = createTestServer(ownerId);
      addServerMember(serverId, memberId, { console: true });

      const member: AuthUser = { id: memberId, role: 'user' };

      expect(await can(member, 'server:view', serverId)).toBe(true);
      expect(await can(member, 'server:console', serverId)).toBe(true);
      expect(await can(member, 'server:files', serverId)).toBe(false);
      expect(await can(member, 'server:delete', serverId)).toBe(false);
      expect(await can(member, 'server:members', serverId)).toBe(false);
    });

    it('member with no permissions cannot view server', async () => {
      const ownerId = await createTestUser('owner-3', 'owner3');
      const memberId = await createTestUser('member-2', 'member2');
      const serverId = createTestServer(ownerId);
      addServerMember(serverId, memberId, {});

      const member: AuthUser = { id: memberId, role: 'user' };
      expect(await can(member, 'server:view', serverId)).toBe(false);
    });

    it('non-member cannot access server', async () => {
      const ownerId = await createTestUser('owner-4', 'owner4');
      const strangerId = await createTestUser('stranger-1', 'stranger1');
      const serverId = createTestServer(ownerId);

      const stranger: AuthUser = { id: strangerId, role: 'user' };
      expect(await can(stranger, 'server:view', serverId)).toBe(false);
      expect(await can(stranger, 'server:power', serverId)).toBe(false);
      expect(await can(stranger, 'server:delete', serverId)).toBe(false);
    });
  });
});

describe('IDOR protection', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(() => {
    cleanupTestApp();
  });

  it('user A cannot see user B profile via /me (session isolation)', async () => {
    // Register admin
    const { cookies: adminCookies } = await registerAdmin(app);

    // Create invite and register user B
    const inviteRes = await createInvite(app, adminCookies['vr_session']!);
    const inviteCode = inviteRes.json().code;
    const { cookies: userBCookies } = await registerUser(app, inviteCode);

    // User B's /me
    const userBMe = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { vr_session: userBCookies['vr_session']! },
    });

    // Admin's /me
    const adminMe = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { vr_session: adminCookies['vr_session']! },
    });

    // They should see different users
    expect(adminMe.json().id).not.toBe(userBMe.json().id);
    expect(adminMe.json().role).toBe('admin');
    expect(userBMe.json().role).toBe('user');
  });

  it('user cannot access admin invite endpoints', async () => {
    const { cookies: adminCookies } = await registerAdmin(app);
    const inviteRes = await createInvite(app, adminCookies['vr_session']!);
    const inviteCode = inviteRes.json().code;

    const { cookies: userCookies } = await registerUser(app, inviteCode);

    // User cannot create invites
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/invites',
      payload: { maxUses: 1 },
      cookies: { vr_session: userCookies['vr_session']! },
    });
    expect(createRes.statusCode).toBe(403);

    // User cannot list invites
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/admin/invites',
      cookies: { vr_session: userCookies['vr_session']! },
    });
    expect(listRes.statusCode).toBe(403);

    // User cannot delete invites
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/invites/${inviteRes.json().id}`,
      cookies: { vr_session: userCookies['vr_session']! },
    });
    expect(deleteRes.statusCode).toBe(403);
  });
});
