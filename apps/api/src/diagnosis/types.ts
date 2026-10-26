/**
 * Diagnosis engine types.
 *
 * Implements §9.3 of IMPLEMENTATION_PLAN.md:
 * Each rule inspects logs, container state, events, and host stats to produce
 * human-readable findings with actionable one-click fixes.
 */

import type { ContainerInspect } from '../docker/driver.js';
import type { GameTemplate } from '../servers/templates.js';
import type { HostCapacityStatus } from '../servers/quota.js';

export type FindingSeverity = 'info' | 'warn' | 'error';

export type FixActionType =
  | 'set-env'
  | 'raise-ram'
  | 'change-port'
  | 'restart'
  | 'open-docs'
  | 'chown-volume'
  | 'clean-disk';

export interface FixAction {
  type: FixActionType;
  payload?: Record<string, unknown>;
}

export interface Fix {
  label: string;
  action: FixAction;
}

export interface Finding {
  ruleId: string;
  severity: FindingSeverity;
  title: string;
  explanation: string;
  fixes: Fix[];
  evidence: string[];
}

export interface EventSummary {
  kind: string;
  message: string;
  ts: string;
  dataJson?: string | null;
}

export interface DiagnosisContext {
  serverId: string;
  logs: string[];
  inspect?: ContainerInspect | null;
  events?: EventSummary[];
  template?: GameTemplate;
  host?: HostCapacityStatus;
}

export interface DiagnosisRule {
  id: string;
  name: string;
  match(ctx: DiagnosisContext): Finding | null;
}
