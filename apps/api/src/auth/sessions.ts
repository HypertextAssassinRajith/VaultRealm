/**
 * Session management — JWT in httpOnly cookies.
 *
 * Tokens are signed with PANEL_SECRET using HMAC-SHA256 via Node's built-in crypto.
 * No external JWT library needed — we use compact JWTs with a minimal payload.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { getConfig } from '../config.js';

export interface SessionPayload {
  /** User ID */
  sub: string;
  /** Role */
  role: 'admin' | 'user';
  /** Issued at (unix seconds) */
  iat: number;
  /** Expires at (unix seconds) */
  exp: number;
}

const SESSION_DURATION_S = 7 * 24 * 60 * 60; // 7 days
const COOKIE_NAME = 'vr_session';

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url');
}

function base64UrlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

function sign(header: string, payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
}

/**
 * Create a signed JWT for the given user.
 */
export function createToken(userId: string, role: 'admin' | 'user'): string {
  const config = getConfig();
  const now = Math.floor(Date.now() / 1000);

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      role,
      iat: now,
      exp: now + SESSION_DURATION_S,
    } satisfies SessionPayload),
  );

  const signature = sign(header, payload, config.PANEL_SECRET);
  return `${header}.${payload}.${signature}`;
}

/**
 * Verify and decode a JWT. Returns null if invalid or expired.
 */
export function verifyToken(token: string): SessionPayload | null {
  const config = getConfig();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts as [string, string, string];

  // Verify signature with timing-safe comparison
  const expectedSig = sign(header, payload, config.PANEL_SECRET);
  const sigBuf = Buffer.from(signature, 'base64url');
  const expectedBuf = Buffer.from(expectedSig, 'base64url');

  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  // Decode payload
  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as SessionPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp < now) return null;

    return decoded;
  } catch {
    return null;
  }
}

/**
 * Cookie options for the session token.
 * Dynamically infers secure flag from request protocol/headers, or honors COOKIE_SECURE setting.
 */
export function getSessionCookieOptions(
  requestOrClear?: FastifyRequest | boolean,
  clear = false,
) {
  let req: FastifyRequest | undefined;
  let isClear = clear;

  if (typeof requestOrClear === 'boolean') {
    isClear = requestOrClear;
  } else {
    req = requestOrClear;
  }

  const config = getConfig();
  const isHttps =
    req?.protocol === 'https' ||
    req?.headers['x-forwarded-proto'] === 'https';

  const isSecure =
    config.COOKIE_SECURE === 'true'
      ? true
      : config.COOKIE_SECURE === 'false'
        ? false
        : isHttps;

  return {
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax' as const,
    maxAge: isClear ? 0 : SESSION_DURATION_S,
  };
}

export { COOKIE_NAME, SESSION_DURATION_S };
