/**
 * Port allocator — assigns host ports from the configured PORT_RANGE.
 *
 * Scans the database for already-allocated ports and picks the next
 * available one from the range. Thread-safe for a single-process panel.
 */

import { getDatabase } from '../db/index.js';
import { serverPorts } from '../db/schema.js';
import { getConfig } from '../config.js';

/**
 * Find N available host ports from the configured range.
 * Throws if not enough ports are available.
 */
export function allocatePorts(count: number): number[] {
  const config = getConfig();
  const { start, end } = config.PORT_RANGE;
  const db = getDatabase();

  // Get all currently allocated ports
  const usedPorts = new Set(
    db.select({ hostPort: serverPorts.hostPort }).from(serverPorts).all().map((r) => r.hostPort),
  );

  const allocated: number[] = [];
  for (let port = start; port <= end && allocated.length < count; port++) {
    if (!usedPorts.has(port)) {
      allocated.push(port);
    }
  }

  if (allocated.length < count) {
    const error = new Error(
      `Not enough available ports. Requested ${count}, but only ${allocated.length} available in range ${start}-${end}.`,
    ) as Error & { statusCode: number; code: string };
    error.statusCode = 503;
    error.code = 'PORT_EXHAUSTION';
    throw error;
  }

  return allocated;
}

/**
 * Check how many ports are still available in the range.
 */
export function getAvailablePortCount(): number {
  const config = getConfig();
  const { start, end } = config.PORT_RANGE;
  const totalPorts = end - start + 1;

  const db = getDatabase();
  const usedCount = db.select({ hostPort: serverPorts.hostPort }).from(serverPorts).all().length;

  return totalPorts - usedCount;
}
