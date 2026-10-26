/**
 * Audit log — write-only helper for tracking mutations.
 *
 * Every route that mutates state must write an audit entry (AGENTS.md rule).
 */

import { getDatabase } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import { nanoid } from 'nanoid';

export interface AuditEntry {
  userId: string | null;
  action: string;
  target?: string;
  ip?: string;
  data?: Record<string, unknown>;
}

/**
 * Write an audit log entry.
 */
export function writeAudit(entry: AuditEntry): void {
  const db = getDatabase();
  db.insert(auditLog)
    .values({
      id: nanoid(),
      userId: entry.userId,
      action: entry.action,
      target: entry.target ?? null,
      ip: entry.ip ?? null,
      dataJson: entry.data ? JSON.stringify(entry.data) : null,
    })
    .run();
}
