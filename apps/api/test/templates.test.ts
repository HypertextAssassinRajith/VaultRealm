import { describe, it, expect } from 'vitest';
import {
  getAllTemplates,
  getTemplate,
  getTemplatesSummary,
  gameTemplateSchema,
  calculateMinecraftHeapMb,
} from '../src/servers/templates.js';

describe('Game Templates', () => {
  it('all built-in templates pass Zod validation schema', () => {
    const templates = getAllTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(4);

    for (const t of templates) {
      const parsed = gameTemplateSchema.safeParse(t);
      expect(parsed.success).toBe(true);
    }
  });

  it('Minecraft Java template has valid Paper configuration and ready regex', () => {
    const mc = getTemplate('minecraft-java');
    expect(mc).toBeDefined();
    expect(mc?.image).toBe('itzg/minecraft-server:latest');
    expect(mc?.ports).toEqual(
      expect.arrayContaining([
        { name: 'Game', containerPort: 25565, protocol: 'tcp' },
        { name: 'RCON', containerPort: 25575, protocol: 'tcp' },
      ]),
    );
    expect(mc?.readyLogRegex).toBeDefined();

    const eula = mc?.env.find((e) => e.key === 'EULA');
    expect(eula?.default).toBe('TRUE');

    const type = mc?.env.find((e) => e.key === 'TYPE');
    expect(type?.default).toBe('PAPER');

    const rconPass = mc?.env.find((e) => e.key === 'RCON_PASSWORD');
    expect(rconPass?.secret).toBe(true);
  });

  it('Palworld template specifies 8GB minimum RAM and UDP game port', () => {
    const pal = getTemplate('palworld');
    expect(pal).toBeDefined();
    expect(pal?.minRamMb).toBeGreaterThanOrEqual(8192);
    expect(pal?.defaultRamMb).toBeGreaterThanOrEqual(12288);

    const gamePort = pal?.ports.find((p) => p.name === 'Game');
    expect(gamePort?.containerPort).toBe(8211);
    expect(gamePort?.protocol).toBe('udp');
  });

  it('getTemplatesSummary redacts secret defaults', () => {
    const summaries = getTemplatesSummary();
    for (const s of summaries) {
      for (const env of s.env) {
        if (env.secret) {
          expect(env.default).toBeUndefined();
        }
      }
    }
  });

  describe('calculateMinecraftHeapMb', () => {
    it('reserves safe off-heap headroom for 1GB to 8GB allocations', () => {
      // 1024MB container -> 768MB heap (256MB headroom)
      expect(calculateMinecraftHeapMb(1024)).toBe(768);

      // 2048MB container -> 1536MB heap (512MB headroom to prevent OOM)
      expect(calculateMinecraftHeapMb(2048)).toBe(1536);

      // 3072MB container -> 2304MB heap (768MB headroom)
      expect(calculateMinecraftHeapMb(3072)).toBe(2304);

      // 4096MB container -> 3328MB heap (768MB headroom)
      expect(calculateMinecraftHeapMb(4096)).toBe(3328);

      // 8192MB container -> 6656MB heap (~20% headroom)
      expect(calculateMinecraftHeapMb(8192)).toBe(6656);
    });

    it('ensures heap is strictly less than container ramMb', () => {
      for (const ram of [1024, 1536, 2048, 3072, 4096, 6144, 8192, 16384]) {
        const heap = calculateMinecraftHeapMb(ram);
        expect(heap).toBeLessThan(ram);
        expect(ram - heap).toBeGreaterThanOrEqual(256);
      }
    });
  });
});
