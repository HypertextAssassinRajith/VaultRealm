/**
 * Quota and Capacity Engine.
 *
 * Enforces per-user quotas (server count, RAM, CPU, disk) and
 * host system limits (HOST_RAM_BUDGET_PCT guard).
 */

import os from 'os';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../db/index.js';
import { users, servers } from '../db/schema.js';
import { getConfig } from '../config.js';

export interface UserQuotaUsage {
  serverCount: number;
  quotaServers: number;
  ramMb: number;
  quotaRamMb: number;
  cpuLimit: number;
  quotaCpu: number;
  diskLimitMb: number;
  quotaDiskMb: number;
}

export interface HostCapacityStatus {
  totalHostRamMb: number;
  budgetPct: number;
  budgetRamMb: number;
  allocatedRamMb: number;
  availableBudgetRamMb: number;
  freeHostRamMb: number;
}

export class QuotaExceededError extends Error {
  statusCode = 403;
  code = 'QUOTA_EXCEEDED';
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class HostCapacityError extends Error {
  statusCode = 507;
  code = 'HOST_CAPACITY_EXCEEDED';
  constructor(message: string) {
    super(message);
    this.name = 'HostCapacityError';
  }
}

/**
 * Returns the current quota usage and limits for a specific user.
 */
export function getUserQuotaUsage(userId: string): UserQuotaUsage {
  const db = getDatabase();

  const user = db.select().from(users).where(eq(users.id, userId)).all()[0];
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const userServers = db.select().from(servers).where(eq(servers.ownerId, userId)).all();

  const ramMb = userServers.reduce((sum, s) => sum + s.ramMb, 0);
  const cpuLimit = userServers.reduce((sum, s) => sum + s.cpuLimit, 0);
  const diskLimitMb = userServers.reduce((sum, s) => sum + s.diskLimitMb, 0);

  return {
    serverCount: userServers.length,
    quotaServers: user.quotaServers,
    ramMb,
    quotaRamMb: user.quotaRamMb,
    cpuLimit,
    quotaCpu: user.quotaCpu,
    diskLimitMb,
    quotaDiskMb: user.quotaDiskMb,
  };
}

/**
 * Returns host-level RAM capacity and budget allocation.
 */
export function getHostCapacityStatus(): HostCapacityStatus {
  const db = getDatabase();
  const config = getConfig();

  const totalHostRamMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeHostRamMb = Math.round(os.freemem() / (1024 * 1024));

  const budgetPct = config.HOST_RAM_BUDGET_PCT ?? 85;
  const budgetRamMb = Math.round((totalHostRamMb * budgetPct) / 100);

  // Consider all servers except those permanently deleted
  const activeServers = db.select().from(servers).all();
  const allocatedRamMb = activeServers.reduce((sum, s) => sum + s.ramMb, 0);
  const availableBudgetRamMb = Math.max(0, budgetRamMb - allocatedRamMb);

  return {
    totalHostRamMb,
    budgetPct,
    budgetRamMb,
    allocatedRamMb,
    availableBudgetRamMb,
    freeHostRamMb,
  };
}

/**
 * Validates that creating a new server or updating resources fits within
 * both user quotas and host capacity guard.
 */
export function assertQuotaAvailable(
  userId: string,
  requestedRamMb: number,
  requestedCpu?: number,
  requestedDiskMb?: number,
  currentServerId?: string,
): void {
  const usage = getUserQuotaUsage(userId);

  // If this is a new server (not modifying existing)
  if (!currentServerId) {
    if (usage.serverCount >= usage.quotaServers) {
      throw new QuotaExceededError(
        `Server count quota reached. You have ${usage.serverCount}/${usage.quotaServers} servers. Delete one to create another.`,
      );
    }
  }

  const newRamTotal = usage.ramMb + requestedRamMb;
  if (newRamTotal > usage.quotaRamMb) {
    const remaining = Math.max(0, usage.quotaRamMb - usage.ramMb);
    throw new QuotaExceededError(
      `RAM quota exceeded. You have ${remaining} MB remaining of your ${usage.quotaRamMb} MB quota; this server requires ${requestedRamMb} MB.`,
    );
  }

  if (requestedCpu && usage.cpuLimit + requestedCpu > usage.quotaCpu) {
    const remaining = Math.max(0, usage.quotaCpu - usage.cpuLimit);
    throw new QuotaExceededError(
      `CPU quota exceeded. You have ${remaining} cores remaining; requested ${requestedCpu} cores.`,
    );
  }

  if (requestedDiskMb && usage.diskLimitMb + requestedDiskMb > usage.quotaDiskMb) {
    const remaining = Math.max(0, usage.quotaDiskMb - usage.diskLimitMb);
    throw new QuotaExceededError(
      `Disk quota exceeded. You have ${remaining} MB remaining; requested ${requestedDiskMb} MB.`,
    );
  }

  // Host guard
  const host = getHostCapacityStatus();
  if (host.allocatedRamMb + requestedRamMb > host.budgetRamMb) {
    throw new HostCapacityError(
      `Host capacity limit reached. Host RAM budget is ${host.budgetRamMb} MB (${host.availableBudgetRamMb} MB available); this server requires ${requestedRamMb} MB.`,
    );
  }
}
