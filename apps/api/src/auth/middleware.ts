/**
 * Auth middleware — extracts and verifies the session from the cookie.
 *
 * Decorates the Fastify request with `user` if authenticated.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, COOKIE_NAME } from './sessions.js';
import type { AuthUser } from './rbac.js';

/**
 * Authenticate the request from the session cookie, Authorization header, or token query param.
 * Returns the user payload or null if not authenticated.
 */
export function extractUser(request: FastifyRequest): AuthUser | null {
  let token = request.cookies[COOKIE_NAME];
  if (!token && request.headers.authorization?.startsWith('Bearer ')) {
    token = request.headers.authorization.slice(7).trim();
  }
  if (!token && typeof (request.query as Record<string, unknown>)?.token === 'string') {
    token = (request.query as Record<string, string>).token;
  }
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  return { id: payload.sub, role: payload.role };
}

/**
 * Require authentication. Sends 401 if not authenticated.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = extractUser(request);
  if (!user) {
    return reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please log in.',
    });
  }
  // Store user on request for route handlers
  (request as FastifyRequest & { user: AuthUser }).user = user;
}

/**
 * Require admin role. Must be called after requireAuth.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = (request as FastifyRequest & { user?: AuthUser }).user;
  if (!user || user.role !== 'admin') {
    return reply.status(403).send({
      code: 'FORBIDDEN',
      message: 'Admin access required.',
    });
  }
}

/**
 * Type helper to get the user from a request that passed requireAuth.
 */
export function getRequestUser(request: FastifyRequest): AuthUser {
  const user = (request as FastifyRequest & { user?: AuthUser }).user;
  if (!user) {
    throw new Error('getRequestUser called without requireAuth middleware');
  }
  return user;
}
