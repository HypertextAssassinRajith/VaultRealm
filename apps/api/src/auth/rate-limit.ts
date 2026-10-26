/**
 * Rate limiter — simple in-memory sliding window.
 *
 * No external dependency needed for a single-server panel.
 * Keyed by IP address, with configurable window and max requests.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

export interface RateLimitConfig {
  /** Unique name for this limiter */
  name: string;
  /** Time window in milliseconds */
  windowMs: number;
  /** Max requests per window */
  max: number;
}

/**
 * Check if a request is rate-limited.
 * Returns { limited: false } or { limited: true, retryAfterMs }.
 */
export function checkRateLimit(
  config: RateLimitConfig,
  key: string,
): { limited: false } | { limited: true; retryAfterMs: number } {
  if (!stores.has(config.name)) {
    stores.set(config.name, new Map());
  }
  const store = stores.get(config.name)!;

  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= config.max) {
    const oldest = entry.timestamps[0]!;
    const retryAfterMs = oldest + config.windowMs - now;
    return { limited: true, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  entry.timestamps.push(now);
  return { limited: false };
}

/**
 * Create a Fastify preHandler that rate-limits by IP.
 */
export function rateLimitPreHandler(config: RateLimitConfig) {
  return async (
    request: { ip: string },
    reply: { status: (code: number) => { send: (body: unknown) => void }; header: (name: string, value: string) => void },
  ) => {
    const result = checkRateLimit(config, request.ip);
    if (result.limited) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      reply.header('Retry-After', retryAfterSec.toString());
      return reply.status(429).send({
        code: 'RATE_LIMITED',
        message: `Too many requests. Try again in ${retryAfterSec} seconds.`,
      });
    }
  };
}

/**
 * Reset all rate limit stores (for tests).
 */
export function resetRateLimits(): void {
  stores.clear();
}

// ── Pre-configured limiters ──────────────────────────────────────────────────

export const loginLimiter = rateLimitPreHandler({
  name: 'login',
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
});

export const registerLimiter = rateLimitPreHandler({
  name: 'register',
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
});

export const apiLimiter = rateLimitPreHandler({
  name: 'api',
  windowMs: 60 * 1000, // 1 minute
  max: 120,
});
