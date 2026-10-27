/**
 * Crypto helpers for LLM API key encryption/decryption.
 *
 * Uses AES-256-GCM with a key derived from PANEL_SECRET.
 * Keys are encrypted at rest and never returned to the browser after saving.
 */

import crypto from 'node:crypto';
import { getConfig } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LABEL = 'vaultrealm-llm-key-v1';

/**
 * Derive a 32-byte AES key from the PANEL_SECRET using HKDF.
 */
function deriveKey(): Buffer {
  const config = getConfig();
  const secret = config.PANEL_SECRET;
  // Use HKDF-SHA256 to derive a proper key from the secret
  return crypto.hkdfSync('sha256', secret, '', KEY_LABEL, 32) as Buffer;
}

/**
 * Encrypt an API key for storage.
 * Returns a base64 string containing IV + ciphertext + auth tag.
 */
export function encryptApiKey(plainKey: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainKey, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Pack: IV (12) + tag (16) + ciphertext
  const packed = Buffer.concat([iv, tag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt an API key from storage.
 */
export function decryptApiKey(encryptedKey: string): string {
  const key = deriveKey();
  const packed = Buffer.from(encryptedKey, 'base64');

  if (packed.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted key: too short');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Mask an API key for display: "sk-...a2b3" (shows last 4 chars).
 * Returns empty string if key is null/undefined.
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key || key.length < 4) return '****';
  const last4 = key.slice(-4);
  return `****${last4}`;
}
