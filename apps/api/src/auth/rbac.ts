/**
 * RBAC — Role-Based Access Control.
 *
 * `can()` is THE single place where permissions are checked (AGENTS.md rule).
 * Every route handler must call `can()` before performing the action.
 */

import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../db/index.js';
import { servers, serverMembers } from '../db/schema.js';

export type Role = 'admin' | 'user';

export type Action =
  // Auth
  | 'auth:manage-invites'
  // Servers
  | 'server:list'
  | 'server:create'
  | 'server:view'
  | 'server:power'
  | 'server:delete'
  | 'server:settings'
  | 'server:console'
  | 'server:files'
  | 'server:backups'
  | 'server:members'
  | 'server:diagnosis'
  // Companion (Phase 6)
  | 'companion:view'
  | 'companion:manage'
  | 'companion:spawn'
  // Admin
  | 'admin:users'
  | 'admin:system'
  | 'admin:invites'
  | 'admin:audit';

export interface AuthUser {
  id: string;
  role: Role;
}

/**
 * Sub-user permission keys for server_members.permissions_json.
 */
export type ServerPermission = 'console' | 'files' | 'power' | 'backups' | 'settings';

/**
 * Check whether a user can perform an action.
 *
 * For server-scoped actions, pass the serverId.
 * The function checks:
 *   1. Admin role → always allowed
 *   2. Server owner → allowed for their own servers
 *   3. Server member → allowed based on permissions_json
 *   4. Otherwise → denied
 */
export async function can(
  user: AuthUser,
  action: Action,
  serverId?: string,
): Promise<boolean> {
  // ── Admin bypass ───────────────────────────────────────────────────────────
  if (user.role === 'admin') return true;

  // ── Global actions (non-server-scoped) ─────────────────────────────────────
  if (!serverId) {
    switch (action) {
      case 'server:list':
      case 'server:create':
      case 'companion:manage':
      case 'companion:view':
        return true; // authenticated users can manage/view their own resources (endpoints, servers)

      case 'auth:manage-invites':
      case 'admin:users':
      case 'admin:system':
      case 'admin:invites':
      case 'admin:audit':
        return false; // only admin

      default:
        return false;
    }
  }

  // ── Server-scoped actions ──────────────────────────────────────────────────

  const db = getDatabase();

  // Check ownership
  const serverResults = db
    .select({ ownerId: servers.ownerId })
    .from(servers)
    .where(eq(servers.id, serverId))
    .all();

  const server = serverResults[0];
  if (!server) return false;
  if (server.ownerId === user.id) return true; // owner can do everything

  // Check sub-user membership
  const memberResults = db
    .select({ permissionsJson: serverMembers.permissionsJson })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, user.id),
      ),
    )
    .all();

  const membership = memberResults[0];
  if (!membership) return false;

  // Parse sub-user permissions
  let permissions: Record<string, boolean>;
  try {
    permissions = JSON.parse(membership.permissionsJson) as Record<string, boolean>;
  } catch {
    return false;
  }

  // Map action to required permission
  const permissionMap: Partial<Record<Action, ServerPermission>> = {
    'server:view': 'console', // if you have any permission, you can view
    'server:power': 'power',
    'server:console': 'console',
    'server:files': 'files',
    'server:backups': 'backups',
    'server:settings': 'settings',
    'server:diagnosis': 'console',
    'companion:view': 'console',
  };

  // These server-scoped actions are owner-only (no sub-user permission)
  const ownerOnly: Action[] = [
    'server:delete',
    'server:members',
    'companion:manage',
    'companion:spawn',
  ];

  if (ownerOnly.includes(action)) return false;

  const requiredPerm = permissionMap[action];
  if (!requiredPerm) return false;

  // Special case: 'server:view' — any permission grants view access
  if (action === 'server:view') {
    return Object.values(permissions).some(Boolean);
  }

  return permissions[requiredPerm] === true;
}

/**
 * Assert a permission, throwing a 403 Fastify error if denied.
 */
export async function assertCan(
  user: AuthUser,
  action: Action,
  serverId?: string,
): Promise<void> {
  const allowed = await can(user, action, serverId);
  if (!allowed) {
    const error = new Error('You do not have permission to perform this action.') as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
}
