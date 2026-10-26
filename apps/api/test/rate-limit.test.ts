import { describe, it, expect, afterEach } from 'vitest';
import { checkRateLimit, resetRateLimits } from '../src/auth/rate-limit.js';

describe('Rate limiter', () => {
  afterEach(() => {
    resetRateLimits();
  });

  const config = {
    name: 'test',
    windowMs: 1000, // 1 second
    max: 3,
  };

  it('allows requests under the limit', () => {
    expect(checkRateLimit(config, '127.0.0.1')).toEqual({ limited: false });
    expect(checkRateLimit(config, '127.0.0.1')).toEqual({ limited: false });
    expect(checkRateLimit(config, '127.0.0.1')).toEqual({ limited: false });
  });

  it('blocks requests over the limit', () => {
    checkRateLimit(config, '127.0.0.1');
    checkRateLimit(config, '127.0.0.1');
    checkRateLimit(config, '127.0.0.1');

    const result = checkRateLimit(config, '127.0.0.1');
    expect(result.limited).toBe(true);
    if (result.limited) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('tracks different keys independently', () => {
    checkRateLimit(config, '10.0.0.1');
    checkRateLimit(config, '10.0.0.1');
    checkRateLimit(config, '10.0.0.1');

    // Different IP should not be limited
    expect(checkRateLimit(config, '10.0.0.2')).toEqual({ limited: false });

    // Original IP should be limited
    const result = checkRateLimit(config, '10.0.0.1');
    expect(result.limited).toBe(true);
  });

  it('tracks different limiter names independently', () => {
    const loginConfig = { name: 'login', windowMs: 1000, max: 2 };
    const apiConfig = { name: 'api', windowMs: 1000, max: 2 };

    checkRateLimit(loginConfig, '127.0.0.1');
    checkRateLimit(loginConfig, '127.0.0.1');

    // Login is now limited
    expect(checkRateLimit(loginConfig, '127.0.0.1').limited).toBe(true);

    // API should still be allowed
    expect(checkRateLimit(apiConfig, '127.0.0.1')).toEqual({ limited: false });
  });

  it('resets all stores', () => {
    checkRateLimit(config, '127.0.0.1');
    checkRateLimit(config, '127.0.0.1');
    checkRateLimit(config, '127.0.0.1');

    resetRateLimits();

    // Should be allowed again
    expect(checkRateLimit(config, '127.0.0.1')).toEqual({ limited: false });
  });
});
