import { describe, it, expect } from 'vitest';
import {
  isDenyListedBlock,
  checkBlockMiningSafety,
  checkProtectedZone,
  isNearContainer,
  checkAttackTargetSafety,
  type ProtectedZone,
} from '../src/safety.js';

describe('Phase 6c — Safety & Anti-Grief Engine', () => {
  describe('Block Deny-List', () => {
    it('detects storage containers as deny-listed', () => {
      const containers = [
        'chest',
        'minecraft:chest',
        'trapped_chest',
        'ender_chest',
        'barrel',
        'shulker_box',
        'white_shulker_box',
        'hopper',
        'dispenser',
        'dropper',
      ];
      for (const block of containers) {
        expect(isDenyListedBlock(block)).toBe(true);
      }
    });

    it('detects signs, beds, doors, and glass as deny-listed', () => {
      const playerBuilds = [
        'oak_sign',
        'hanging_sign',
        'white_bed',
        'iron_door',
        'oak_trapdoor',
        'spruce_fence_gate',
        'glass',
        'glass_pane',
        'red_stained_glass',
      ];
      for (const block of playerBuilds) {
        expect(isDenyListedBlock(block)).toBe(true);
      }
    });

    it('detects bedrock, portals, spawners, beacons as deny-listed', () => {
      expect(isDenyListedBlock('bedrock')).toBe(true);
      expect(isDenyListedBlock('spawner')).toBe(true);
      expect(isDenyListedBlock('beacon')).toBe(true);
      expect(isDenyListedBlock('nether_portal')).toBe(true);
      expect(isDenyListedBlock('command_block')).toBe(true);
    });

    it('permits resource and wilderness blocks', () => {
      const allowed = [
        'oak_log',
        'stone',
        'dirt',
        'iron_ore',
        'coal_ore',
        'cobblestone',
        'sand',
        'gravel',
        'oak_leaves',
      ];
      for (const block of allowed) {
        expect(isDenyListedBlock(block)).toBe(false);
      }
    });
  });

  describe('Protected Zones Guard', () => {
    const zones: ProtectedZone[] = [
      {
        name: 'Spawn Plaza',
        center: { x: 0, y: 64, z: 0 },
        radius: 20,
      },
      {
        name: 'Player Base',
        center: { x: 100, y: 70, z: 200 },
        radius: 15,
      },
    ];

    it('identifies positions inside protected zones', () => {
      const insideSpawn = checkProtectedZone({ x: 5, y: 64, z: 5 }, zones);
      expect(insideSpawn.isProtected).toBe(true);
      expect(insideSpawn.zoneName).toBe('Spawn Plaza');

      const insideBase = checkProtectedZone({ x: 105, y: 72, z: 205 }, zones);
      expect(insideBase.isProtected).toBe(true);
      expect(insideBase.zoneName).toBe('Player Base');
    });

    it('permits positions outside protected zones', () => {
      const outside = checkProtectedZone({ x: 50, y: 64, z: 50 }, zones);
      expect(outside.isProtected).toBe(false);
    });
  });

  describe('Container Proximity Guard', () => {
    it('blocks mining within 5 blocks of a container', () => {
      const containers = [{ x: 10, y: 64, z: 10 }];

      // 3 blocks away
      expect(isNearContainer({ x: 12, y: 64, z: 10 }, containers, 5)).toBe(true);
      // Exactly 5 blocks away
      expect(isNearContainer({ x: 15, y: 64, z: 10 }, containers, 5)).toBe(true);
      // 6 blocks away
      expect(isNearContainer({ x: 16, y: 64, z: 10 }, containers, 5)).toBe(false);
    });
  });

  describe('Comprehensive Mining Safety Check', () => {
    it('blocks deny-listed block regardless of position', () => {
      const res = checkBlockMiningSafety('chest', { x: 500, y: 64, z: 500 });
      expect(res.safe).toBe(false);
      expect(res.reason).toContain('deny-list');
    });

    it('blocks normal block inside protected zone', () => {
      const zones: ProtectedZone[] = [
        { name: 'Spawn', center: { x: 0, y: 64, z: 0 }, radius: 10 },
      ];
      const res = checkBlockMiningSafety('stone', { x: 2, y: 64, z: 2 }, { protectedZones: zones });
      expect(res.safe).toBe(false);
      expect(res.reason).toContain('protected zone "Spawn"');
    });

    it('blocks normal block near container', () => {
      const containers = [{ x: 50, y: 64, z: 50 }];
      const res = checkBlockMiningSafety('oak_log', { x: 52, y: 64, z: 50 }, { nearbyContainers: containers });
      expect(res.safe).toBe(false);
      expect(res.reason).toContain('within 5 blocks of a chest');
    });

    it('allows normal block in safe wilderness location', () => {
      const res = checkBlockMiningSafety('oak_log', { x: 500, y: 64, z: 500 });
      expect(res.safe).toBe(true);
    });
  });

  describe('Combat Safety & Absolute PvP Prohibition', () => {
    it('strictly forbids attacking player entities', () => {
      const targetPlayer = checkAttackTargetSafety('player', 'Steve');
      expect(targetPlayer.safe).toBe(false);
      expect(targetPlayer.reason).toContain('never engage in PvP');

      const namedPlayer = checkAttackTargetSafety('entity', 'player');
      expect(namedPlayer.safe).toBe(false);
    });

    it('permits attacking recognized hostile mobs', () => {
      const hostiles = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'drowned'];
      for (const mob of hostiles) {
        const res = checkAttackTargetSafety('mob', mob);
        expect(res.safe).toBe(true);
      }
    });

    it('rejects attacking passive animals or villagers', () => {
      const passives = ['cow', 'pig', 'sheep', 'villager', 'iron_golem', 'horse'];
      for (const creature of passives) {
        const res = checkAttackTargetSafety('mob', creature);
        expect(res.safe).toBe(false);
        expect(res.reason).toContain('not a recognized hostile mob');
      }
    });
  });
});
