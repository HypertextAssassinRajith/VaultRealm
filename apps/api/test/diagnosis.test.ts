import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateRules } from '../src/diagnosis/index.js';
import type { DiagnosisContext } from '../src/diagnosis/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, 'fixtures', 'logs');

function loadLogFixture(filename: string): string[] {
  const content = fs.readFileSync(path.join(fixturesDir, filename), 'utf-8');
  return content.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

describe('Diagnosis Rules Engine', () => {
  it('rule: oom-killed detects OutOfMemoryError and suggests raise-ram', () => {
    const logs = loadLogFixture('oom-killed.log');
    const ctx: DiagnosisContext = {
      serverId: 'test-srv-1',
      logs,
      inspect: {
        id: 'c1',
        name: 'vr-test-srv-1',
        state: {
          status: 'exited',
          running: false,
          exitCode: 137,
          oomKilled: true,
          startedAt: '',
          finishedAt: '',
          error: '',
        },
        image: 'itzg/minecraft-server:latest',
        config: { env: [], labels: {} },
        hostConfig: { memory: 2048 * 1024 * 1024, nanoCpus: 2, pidsLimit: 512, restartPolicy: { name: 'no', maximumRetryCount: 0 } },
        networkSettings: { ports: {} },
        mounts: [],
      },
    };

    const findings = evaluateRules(ctx);
    const oom = findings.find((f) => f.ruleId === 'oom-killed');
    expect(oom).toBeDefined();
    expect(oom?.severity).toBe('error');
    expect(oom?.title).toMatch(/out of memory/i);
    expect(oom?.fixes.some((fx) => fx.action.type === 'raise-ram')).toBe(true);
  });

  it('rule: port-in-use detects BindException and suggests change-port', () => {
    const logs = loadLogFixture('port-in-use.log');
    const ctx: DiagnosisContext = {
      serverId: 'test-srv-2',
      logs,
    };

    const findings = evaluateRules(ctx);
    const port = findings.find((f) => f.ruleId === 'port-in-use');
    expect(port).toBeDefined();
    expect(port?.severity).toBe('error');
    expect(port?.title).toMatch(/port is already in use/i);
    expect(port?.fixes.some((fx) => fx.action.type === 'change-port')).toBe(true);
  });

  it('rule: eula-not-accepted detects EULA agreement requirement and provides set-env fix', () => {
    const logs = loadLogFixture('eula-not-accepted.log');
    const ctx: DiagnosisContext = {
      serverId: 'test-srv-3',
      logs,
    };

    const findings = evaluateRules(ctx);
    const eula = findings.find((f) => f.ruleId === 'eula-not-accepted');
    expect(eula).toBeDefined();
    expect(eula?.severity).toBe('error');
    expect(eula?.title).toMatch(/eula/i);
    expect(eula?.fixes.some((fx) => fx.action.type === 'set-env' && fx.action.payload?.EULA === 'TRUE')).toBe(true);
  });

  it('rule: java-version detects UnsupportedClassVersionError and suggests upgrade', () => {
    const logs = loadLogFixture('java-version.log');
    const ctx: DiagnosisContext = {
      serverId: 'test-srv-4',
      logs,
    };

    const findings = evaluateRules(ctx);
    const java = findings.find((f) => f.ruleId === 'java-version');
    expect(java).toBeDefined();
    expect(java?.severity).toBe('error');
    expect(java?.title).toMatch(/incompatible java/i);
    expect(java?.fixes.some((fx) => fx.action.type === 'set-env')).toBe(true);
  });

  it('rule: permission-denied detects volume permission issues and suggests chown-volume', () => {
    const logs = loadLogFixture('permission-denied.log');
    const ctx: DiagnosisContext = {
      serverId: 'test-srv-5',
      logs,
    };

    const findings = evaluateRules(ctx);
    const perm = findings.find((f) => f.ruleId === 'permission-denied');
    expect(perm).toBeDefined();
    expect(perm?.severity).toBe('error');
    expect(perm?.title).toMatch(/permission denied/i);
    expect(perm?.fixes.some((fx) => fx.action.type === 'chown-volume')).toBe(true);
  });

  it('rule: disk-full detects storage exhaustion and suggests disk cleanup', () => {
    const logs = loadLogFixture('disk-full.log');
    const ctx: DiagnosisContext = {
      serverId: 'test-srv-6',
      logs,
    };

    const findings = evaluateRules(ctx);
    const disk = findings.find((f) => f.ruleId === 'disk-full');
    expect(disk).toBeDefined();
    expect(disk?.severity).toBe('error');
    expect(disk?.title).toMatch(/disk is full/i);
    expect(disk?.fixes.some((fx) => fx.action.type === 'clean-disk')).toBe(true);
  });

  it('rule: crash-loop detects repeated crash loop events', () => {
    const logs = loadLogFixture('crash-loop.log');
    const ctx: DiagnosisContext = {
      serverId: 'test-srv-7',
      logs,
    };

    const findings = evaluateRules(ctx);
    const loop = findings.find((f) => f.ruleId === 'crash-loop');
    expect(loop).toBeDefined();
    expect(loop?.severity).toBe('error');
    expect(loop?.title).toMatch(/crash loop/i);
  });

  it('rule: no-ready-signal detects startup readiness timeout', () => {
    const logs = loadLogFixture('no-ready-signal.log');
    const ctx: DiagnosisContext = {
      serverId: 'test-srv-8',
      logs,
    };

    const findings = evaluateRules(ctx);
    const ready = findings.find((f) => f.ruleId === 'no-ready-signal');
    expect(ready).toBeDefined();
    expect(ready?.severity).toBe('warn');
    expect(ready?.title).toMatch(/ready signal/i);
  });
});
