/**
 * Bot Tokens — short-lived HMAC-signed tokens for bot-runner → gateway auth.
 *
 * Bot runners don't have access to session cookies or API keys.
 * Instead they receive a signed token that identifies the bot and expires.
 */

import crypto from 'node:crypto';
import { getConfig } from '../config.js';

const TOKEN_VERSION = 'bt1';
const DEFAULT_EXPIRY_SEC = 86400; // 24 hours

interface BotTokenPayload {
  botId: string;
  exp: number;
}

/**
 * Create a signed bot token.
 */
export function createBotToken(
  botId: string,
  expiresInSec: number = DEFAULT_EXPIRY_SEC,
): string {
  const config = getConfig();
  const payload: BotTokenPayload = {
    botId,
    exp: Math.floor(Date.now() / 1000) + expiresInSec,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.PANEL_SECRET)
    .update(`${TOKEN_VERSION}.${payloadB64}`)
    .digest('base64url');

  return `${TOKEN_VERSION}.${payloadB64}.${signature}`;
}

/**
 * Verify a bot token. Returns the payload if valid, null otherwise.
 */
export function verifyBotToken(token: string): { botId: string } | null {
  const config = getConfig();
  const parts = token.split('.');

  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return null;
  }

  const [version, payloadB64, signature] = parts as [string, string, string];

  // Verify signature
  const expectedSig = crypto
    .createHmac('sha256', config.PANEL_SECRET)
    .update(`${version}.${payloadB64}`)
    .digest('base64url');

  if (!crypto.timingSafeEqual(
    Buffer.from(signature, 'base64url'),
    Buffer.from(expectedSig, 'base64url'),
  )) {
    return null;
  }

  // Decode payload
  let payload: BotTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as BotTokenPayload;
  } catch {
    return null;
  }

  // Check expiry
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return { botId: payload.botId };
}
