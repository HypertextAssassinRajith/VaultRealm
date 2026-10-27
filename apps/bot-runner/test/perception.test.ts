import { describe, it, expect } from 'vitest';
import { buildPerceptionSnapshot } from '../src/perception.js';

describe('Phase 6c — Perception Snapshot Generator', () => {
  it('builds a structured, human-readable snapshot from state', () => {
    const snapshot = buildPerceptionSnapshot({
      botName: 'Buddy',
      position: { x: 12.4, y: 64.0, z: -45.8 },
      dimension: 'overworld',
      timeOfDay: 'day',
      weather: 'clear',
      health: 18.5,
      food: 19,
      heldItem: 'iron_pickaxe',
      armor: {
        head: 'iron_helmet',
        torso: 'iron_chestplate',
        legs: null,
        feet: 'iron_boots',
      },
      inventory: [
        { name: 'minecraft:oak_log', count: 16 },
        { name: 'minecraft:bread', count: 5 },
      ],
      nearbyPlayers: [
        { name: 'Steve', type: 'player', distance: 3.2, heldItem: 'diamond_sword' },
      ],
      nearbyMobs: [
        { name: 'zombie', type: 'mob', distance: 12.1 },
      ],
      notableBlocks: [
        { name: 'chest', x: 10, y: 64, z: -40, distance: 4.2 },
      ],
      currentTask: 'Following Steve',
      lastActionResult: 'Mined 4x oak_log',
      savedPlaces: {
        home: { x: 100, y: 64, z: 200 },
      },
      recentChat: [
        { username: 'Steve', message: 'Buddy, follow me' },
      ],
    });

    expect(snapshot).toContain('[LOCATION] Pos: (12, 64, -46) | Dim: overworld | Time: day | Weather: clear');
    expect(snapshot).toContain('[VITALS] Health: 19/20 | Food: 19/20 | Main Hand: iron_pickaxe');
    expect(snapshot).toContain('[ARMOR] Head: iron_helmet | Chest: iron_chestplate | Feet: iron_boots');
    expect(snapshot).toContain('[INVENTORY] 16x oak_log, 5x bread');
    expect(snapshot).toContain('[NEARBY PLAYERS] Steve (3m away, holding diamond_sword)');
    expect(snapshot).toContain('[NEARBY MOBS] zombie (12m)');
    expect(snapshot).toContain('[NEARBY BLOCKS] chest at (10,64,-40, 4m)');
    expect(snapshot).toContain('[SAVED PLACES] home: (100,64,200)');
    expect(snapshot).toContain('[CURRENT TASK] Following Steve');
    expect(snapshot).toContain('[LAST ACTION RESULT] Mined 4x oak_log');
    expect(snapshot).toContain('[RECENT CHAT] <Steve> Buddy, follow me');
  });

  it('handles empty/minimal state gracefully', () => {
    const snapshot = buildPerceptionSnapshot({
      botName: 'Buddy',
      position: { x: 0, y: 0, z: 0 },
      health: 20,
      food: 20,
      inventory: [],
      nearbyPlayers: [],
      nearbyMobs: [],
      notableBlocks: [],
    });

    expect(snapshot).toContain('[INVENTORY] Empty');
    expect(snapshot).toContain('[NEARBY PLAYERS] None');
    expect(snapshot).toContain('[NEARBY MOBS] None');
    expect(snapshot).not.toContain('[ARMOR]');
    expect(snapshot).not.toContain('[SAVED PLACES]');
  });
});
