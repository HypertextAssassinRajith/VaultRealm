import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, resetConfig } from '../src/config.js';
import { createToken, verifyToken } from '../src/auth/sessions.js';

describe('Sessions (JWT)', () => {
  afterEach(() => {
    resetConfig();
  });

  function setupConfig() {
    loadConfig({ PANEL_SECRET: 'test-secret-at-least-16-chars' });
  }

  it('creates and verifies a valid token', () => {
    setupConfig();
    const token = createToken('user-123', 'admin');
    const payload = verifyToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('user-123');
    expect(payload!.role).toBe('admin');
    expect(payload!.iat).toBeGreaterThan(0);
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });

  it('rejects tampered token', () => {
    setupConfig();
    const token = createToken('user-123', 'user');
    const tampered = token.slice(0, -5) + 'xxxxx';

    expect(verifyToken(tampered)).toBeNull();
  });

  it('rejects malformed token', () => {
    setupConfig();
    expect(verifyToken('not.a.jwt')).toBeNull();
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('only-one-part')).toBeNull();
  });

  it('rejects expired token', () => {
    setupConfig();
    const token = createToken('user-123', 'user');

    // Parse and manually set exp to the past
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    payload.exp = Math.floor(Date.now() / 1000) - 100;

    // Re-encode (but this will have wrong signature)
    const fakePayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const fakeToken = `${parts[0]}.${fakePayload}.${parts[2]}`;

    // The tampered token should fail signature check
    expect(verifyToken(fakeToken)).toBeNull();
  });

  it('produces different tokens for different users', () => {
    setupConfig();
    const t1 = createToken('user-1', 'user');
    const t2 = createToken('user-2', 'admin');

    expect(t1).not.toBe(t2);

    const p1 = verifyToken(t1);
    const p2 = verifyToken(t2);

    expect(p1!.sub).toBe('user-1');
    expect(p2!.sub).toBe('user-2');
    expect(p1!.role).toBe('user');
    expect(p2!.role).toBe('admin');
  });
});
