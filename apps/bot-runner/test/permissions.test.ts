import { describe, it, expect } from 'vitest';
import {
  getPlayerRole,
  canPlayerExecuteSkill,
  FORBIDDEN_ACTIONS,
} from '../src/permissions.js';

describe('Phase 6c — Permissions & Authorization Matrix', () => {
  describe('Role resolution', () => {
    it('resolves owner correctly regardless of casing', () => {
      expect(getPlayerRole('Steve', 'Steve')).toBe('owner');
      expect(getPlayerRole('steve', 'STEVE')).toBe('owner');
      expect(getPlayerRole('  Steve  ', 'steve')).toBe('owner');
    });

    it('resolves trusted player correctly', () => {
      const trusted = ['Alex', 'Bob'];
      expect(getPlayerRole('Alex', 'Steve', trusted)).toBe('trusted');
      expect(getPlayerRole('bob', 'Steve', trusted)).toBe('trusted');
    });

    it('resolves other players as guests', () => {
      expect(getPlayerRole('random_griefer', 'Steve', ['Alex'])).toBe('guest');
      expect(getPlayerRole('Eve', 'Steve')).toBe('guest');
    });
  });

  describe('Skill authorization matrix', () => {
    it('allows guests to use safe skills (say, follow, come, stay, status, stop)', () => {
      const safeSkills = ['say', 'follow', 'come', 'stay', 'status', 'stop'];
      for (const skill of safeSkills) {
        const res = canPlayerExecuteSkill('guest', 'everyone', skill);
        expect(res.allowed).toBe(true);
      }
    });

    it('blocks guests from using destructive or advanced skills (mine, craft, attack, guard)', () => {
      const advancedSkills = ['mine', 'craft', 'collect', 'give', 'attack', 'guard', 'placeBlock', 'savePlace'];
      for (const skill of advancedSkills) {
        const res = canPlayerExecuteSkill('guest', 'everyone', skill);
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain('Permission denied');
      }
    });

    it('allows trusted players to use utility skills (mine, craft, collect, give, eat, sleep)', () => {
      const trustedSkills = ['mine', 'craft', 'collect', 'give', 'eat', 'sleep', 'equip'];
      for (const skill of trustedSkills) {
        const res = canPlayerExecuteSkill('trusted', 'everyone', skill);
        expect(res.allowed).toBe(true);
      }
    });

    it('blocks trusted players from owner-only actions (guard, attack, placeBlock, savePlace, store)', () => {
      const ownerSkills = ['guard', 'attack', 'placeBlock', 'savePlace', 'store', 'leave'];
      for (const skill of ownerSkills) {
        const res = canPlayerExecuteSkill('trusted', 'everyone', skill);
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain('Permission denied');
      }
    });

    it('allows owner to execute all supported companion skills', () => {
      const allSkills = [
        'say', 'follow', 'goTo', 'come', 'stay', 'status', 'stop',
        'mine', 'collect', 'craft', 'give', 'eat', 'sleep', 'equip',
        'guard', 'attack', 'placeBlock', 'savePlace', 'store', 'leave',
      ];
      for (const skill of allSkills) {
        const res = canPlayerExecuteSkill('owner', 'everyone', skill);
        expect(res.allowed).toBe(true);
      }
    });
  });

  describe('Command Policy enforcement', () => {
    it('rejects non-owners when policy is owner_only', () => {
      expect(canPlayerExecuteSkill('trusted', 'owner_only', 'follow').allowed).toBe(false);
      expect(canPlayerExecuteSkill('guest', 'owner_only', 'say').allowed).toBe(false);
      expect(canPlayerExecuteSkill('owner', 'owner_only', 'follow').allowed).toBe(true);
    });

    it('rejects guests when policy is trusted', () => {
      expect(canPlayerExecuteSkill('guest', 'trusted', 'follow').allowed).toBe(false);
      expect(canPlayerExecuteSkill('trusted', 'trusted', 'follow').allowed).toBe(true);
      expect(canPlayerExecuteSkill('owner', 'trusted', 'follow').allowed).toBe(true);
    });
  });

  describe('Prompt Injection & Forbidden Actions Defense', () => {
    it('unconditionally blocks forbidden admin/console/op/pvp actions for any role', () => {
      for (const action of FORBIDDEN_ACTIONS) {
        const resGuest = canPlayerExecuteSkill('guest', 'everyone', action);
        expect(resGuest.allowed).toBe(false);
        expect(resGuest.reason).toContain('Forbidden action');

        const resOwner = canPlayerExecuteSkill('owner', 'everyone', action);
        expect(resOwner.allowed).toBe(false);
        expect(resOwner.reason).toContain('Forbidden action');
      }
    });
  });
});
