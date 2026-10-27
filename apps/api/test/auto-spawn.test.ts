import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateAutoSpawn,
  pauseAutoSpawn,
  resetAutoSpawnState,
  checkChatSummon,
} from '../src/companion/auto-spawn.js';

describe('Phase 6d — Auto-Spawn Hysteresis & Chat Summon', () => {
  const serverId = 'test-server-spawn';

  beforeEach(() => {
    resetAutoSpawnState();
  });

  describe('Auto-Solo Mode Hysteresis', () => {
    it('spawns the bot when 1 player is active for >= 20 seconds', () => {
      // 0 to 10 seconds -> threshold not met
      const step1 = evaluateAutoSpawn(serverId, 1, 'offline', 'auto-solo', 10);
      expect(step1.action).toBe('none');

      // 10 to 20 seconds -> threshold met (20s) -> spawn!
      const step2 = evaluateAutoSpawn(serverId, 1, 'offline', 'auto-solo', 10);
      expect(step2.action).toBe('spawn');
      if (step2.action === 'spawn') {
        expect(step2.reason).toContain('1 player on server for 20s');
      }

      // If already online, does not re-spawn
      const step3 = evaluateAutoSpawn(serverId, 1, 'online', 'auto-solo', 10);
      expect(step3.action).toBe('none');
    });

    it('bids farewell and despawns when >= 2 players are active for >= 60 seconds', () => {
      // Bot is currently online with 1 player
      evaluateAutoSpawn(serverId, 1, 'offline', 'auto-solo', 20);

      // Second player joins -> multi-player timer starts
      // 0 to 30 seconds -> threshold not met
      const step1 = evaluateAutoSpawn(serverId, 2, 'online', 'auto-solo', 30);
      expect(step1.action).toBe('none');

      // 30 to 60 seconds -> threshold met (60s) -> despawn (farewell)
      const step2 = evaluateAutoSpawn(serverId, 2, 'online', 'auto-solo', 30);
      expect(step2.action).toBe('despawn');
      if (step2.action === 'despawn') {
        expect(step2.reason).toContain('companion bids farewell');
      }
    });

    it('immediately despawns when 0 players are active so server can idle-stop', () => {
      // Bot is online
      const action = evaluateAutoSpawn(serverId, 0, 'online', 'auto-solo', 10);
      expect(action.action).toBe('despawn');
      if (action.action === 'despawn') {
        expect(action.reason).toContain('0 players on server; despawning for server idle stop');
      }
    });

    it('respects pause duration from !leave command (2 hours hysteresis)', () => {
      // Player commands !leave -> pauses for 2 hours
      pauseAutoSpawn(serverId, 2 * 3600_000);

      // Player remains solo for 30s -> should NOT spawn because paused
      const step1 = evaluateAutoSpawn(serverId, 1, 'offline', 'auto-solo', 30);
      expect(step1.action).toBe('none');
    });

    it('handles "always" mode by keeping bot spawned while server runs', () => {
      const step1 = evaluateAutoSpawn(serverId, 0, 'offline', 'always', 10);
      expect(step1.action).toBe('spawn');

      const step2 = evaluateAutoSpawn(serverId, 0, 'online', 'always', 10);
      expect(step2.action).toBe('none');
    });

    it('does nothing when mode is "off"', () => {
      const step = evaluateAutoSpawn(serverId, 1, 'offline', 'off', 100);
      expect(step.action).toBe('none');
    });
  });

  describe('Chat Summon Trigger (!buddy)', () => {
    it('detects chat summon in server log lines', () => {
      const line1 = '[10:20:15 INFO]: <Steve> !buddy';
      const res1 = checkChatSummon(line1);
      expect(res1.isSummon).toBe(true);
      expect(res1.player).toBe('Steve');

      const line2 = '[10:20:20 INFO]: [Not Secure] <Alex> !Buddy come here';
      const res2 = checkChatSummon(line2);
      expect(res2.isSummon).toBe(true);
      expect(res2.player).toBe('Alex');
    });

    it('ignores regular chat messages', () => {
      expect(checkChatSummon('<Steve> hello world').isSummon).toBe(false);
      expect(checkChatSummon('<Steve> I like buddy').isSummon).toBe(false);
    });
  });
});
