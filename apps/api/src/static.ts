/**
 * Static file serving and SPA routing fallback for production frontend assets.
 */

import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Resolves the path to the web build output directory.
 * Checks an explicit directory, WEB_DIST_DIR environment variable, or known relative paths.
 *
 * @param customDir - Optional explicit directory override
 * @returns Absolute directory path if found, or null
 */
export function resolveWebDistPath(customDir?: string): string | null {
  const filename = fileURLToPath(import.meta.url);
  const currentDir = dirname(filename);

  const candidates = [
    customDir,
    process.env.WEB_DIST_DIR,
    resolve(currentDir, '../../web/dist'),
    resolve(process.cwd(), 'apps/web/dist'),
  ].filter((p): p is string => Boolean(p));

  return candidates.find((dir) => existsSync(dir)) ?? null;
}

/**
 * Checks whether an incoming request is a client-side navigation route for SPA fallback.
 *
 * @param method - HTTP request method
 * @param url - Incoming request URL
 * @returns boolean indicating whether the SPA index.html should be served
 */
export function isSpaRoute(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }

  const pathname = url.split('?')[0] ?? '';

  // Do not fallback for API, WebSocket, internal, or health check routes
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/ws') ||
    pathname.startsWith('/internal') ||
    pathname === '/healthz'
  ) {
    return false;
  }

  // Do not fallback for file assets with extensions (e.g. .js, .css, .ico, .map)
  const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pathname);
  if (hasFileExtension) {
    return false;
  }

  return true;
}

/**
 * Registers static asset serving on Fastify if frontend assets are present.
 *
 * @param app - Fastify instance
 * @param customDir - Optional path override for static assets
 * @returns boolean indicating whether static serving was enabled
 */
export async function registerStatic(
  app: FastifyInstance,
  customDir?: string,
): Promise<boolean> {
  const distPath = resolveWebDistPath(customDir);
  if (!distPath) {
    return false;
  }

  await app.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
    wildcard: false,
  });

  return true;
}
