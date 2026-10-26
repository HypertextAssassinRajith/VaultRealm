import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resetConfig } from '../src/config.js';
import { initDatabase, closeDatabase, runMigrations, getDatabase } from '../src/db/index.js';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('database', () => {
  const testDir = join(tmpdir(), `vaultrealm-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    loadConfig({
      PANEL_SECRET: 'test-secret-at-least-16-chars',
      DATA_DIR: testDir,
    });
  });

  afterEach(() => {
    closeDatabase();
    resetConfig();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('initializes and returns a database instance', () => {
    const db = initDatabase();
    expect(db).toBeTruthy();
  });

  it('runs migrations without errors', () => {
    initDatabase();
    expect(() => runMigrations()).not.toThrow();
  });

  it('returns same instance on repeated calls', () => {
    const db1 = initDatabase();
    const db2 = initDatabase();
    expect(db1).toBe(db2);
  });

  it('getDatabase throws before init', () => {
    expect(() => getDatabase()).toThrow('Database not initialized');
  });

  it('creates tables via migrations', () => {
    initDatabase();
    runMigrations();

    // getDatabase should work after init
    const db = getDatabase();
    expect(db).toBeTruthy();
  });
});
