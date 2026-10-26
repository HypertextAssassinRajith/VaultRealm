import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, resetConfig } from '../src/config.js';

describe('config', () => {
  afterEach(() => {
    resetConfig();
  });

  it('loads valid config from overrides', () => {
    const config = loadConfig({
      PANEL_SECRET: 'test-secret-at-least-16-chars',
    });

    expect(config.PORT).toBe(3001);
    expect(config.NODE_ENV).toBe('development');
    expect(config.PANEL_SECRET).toBe('test-secret-at-least-16-chars');
    expect(config.DATA_DIR).toBe('./data');
    expect(config.PORT_RANGE).toEqual({ start: 25000, end: 29999 });
    expect(config.HOST_RAM_BUDGET_PCT).toBe(85);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.ALLOW_PRIVATE_LLM_ENDPOINTS).toBe(false);
    expect(config.CORS_ORIGIN).toBe('http://localhost:5173');
  });

  it('rejects missing PANEL_SECRET', () => {
    expect(() => loadConfig({})).toThrow('Invalid configuration');
  });

  it('rejects short PANEL_SECRET', () => {
    expect(() => loadConfig({ PANEL_SECRET: 'short' })).toThrow('at least 16 characters');
  });

  it('parses custom PORT_RANGE', () => {
    const config = loadConfig({
      PANEL_SECRET: 'test-secret-at-least-16-chars',
      PORT_RANGE: '30000-39999',
    });
    expect(config.PORT_RANGE).toEqual({ start: 30000, end: 39999 });
  });

  it('parses ALLOW_PRIVATE_LLM_ENDPOINTS', () => {
    const config = loadConfig({
      PANEL_SECRET: 'test-secret-at-least-16-chars',
      ALLOW_PRIVATE_LLM_ENDPOINTS: 'true',
    });
    expect(config.ALLOW_PRIVATE_LLM_ENDPOINTS).toBe(true);
  });

  it('coerces PORT to number', () => {
    const config = loadConfig({
      PANEL_SECRET: 'test-secret-at-least-16-chars',
      PORT: '4000',
    });
    expect(config.PORT).toBe(4000);
  });
});
