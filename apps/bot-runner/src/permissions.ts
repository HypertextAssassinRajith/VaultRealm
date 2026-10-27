/**
 * Permissions & Authorization Matrix for Companion Bot.
 *
 * Implements §9B.5 of IMPLEMENTATION_PLAN.md:
 * - Player roles: 'owner' | 'trusted' | 'guest'
 * - Policies: 'owner_only' | 'trusted' | 'everyone'
 * - Prompt-injection defense: Authorization is enforced in CODE for every
 *   tool call using the speaker's role, never relying on the model to refuse.
 * - Bots never get console, op, or slash-command tools.
 */

export type PlayerRole = 'owner' | 'trusted' | 'guest';
export type CommandPolicy = 'owner_only' | 'trusted' | 'everyone';

export type SkillName =
  | 'say'
  | 'follow'
  | 'goTo'
  | 'come'
  | 'stay'
  | 'status'
  | 'stop'
  | 'mine'
  | 'collect'
  | 'craft'
  | 'give'
  | 'eat'
  | 'sleep'
  | 'equip'
  | 'guard'
  | 'attack'
  | 'placeBlock'
  | 'savePlace'
  | 'store'
  | 'leave';

/**
 * Strict role capabilities matrix.
 *
 * - Guest: say, follow, come, stay, status, stop
 * - Trusted: + mine, collect, craft, give, eat, sleep, equip
 * - Owner: + guard, attack (mobs only), placeBlock, savePlace, store, leave
 */
export const ROLE_SKILL_PERMISSIONS: Record<PlayerRole, ReadonlySet<SkillName>> = {
  guest: new Set<SkillName>([
    'say',
    'follow',
    'goTo',
    'come',
    'stay',
    'status',
    'stop',
  ]),
  trusted: new Set<SkillName>([
    'say',
    'follow',
    'goTo',
    'come',
    'stay',
    'status',
    'stop',
    'mine',
    'collect',
    'craft',
    'give',
    'eat',
    'sleep',
    'equip',
  ]),
  owner: new Set<SkillName>([
    'say',
    'follow',
    'goTo',
    'come',
    'stay',
    'status',
    'stop',
    'mine',
    'collect',
    'craft',
    'give',
    'eat',
    'sleep',
    'equip',
    'guard',
    'attack',
    'placeBlock',
    'savePlace',
    'store',
    'leave',
  ]),
};

/**
 * Denied tools/actions that can NEVER be executed under any circumstance,
 * even if an LLM is tricked into generating them.
 */
export const FORBIDDEN_ACTIONS = new Set([
  'op',
  'deop',
  'console',
  'command',
  'slash_command',
  'rcon',
  'exec',
  'execute',
  'teleport_player',
  'kill_player',
  'attack_player',
  'pvp',
  'kick',
  'ban',
  'whitelist',
]);

/**
 * Resolve player role from username, owner username, and trusted players list.
 */
export function getPlayerRole(
  username: string,
  ownerName: string,
  trustedPlayers: string[] = [],
): PlayerRole {
  const normUser = username.trim().toLowerCase();
  const normOwner = ownerName.trim().toLowerCase();

  if (normUser === normOwner) {
    return 'owner';
  }

  const isTrusted = trustedPlayers.some(
    (p) => p.trim().toLowerCase() === normUser,
  );
  if (isTrusted) {
    return 'trusted';
  }

  return 'guest';
}

export interface SkillAuthResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Authorize skill execution against player role and server command policy.
 *
 * Enforced in code on EVERY tool call:
 * 1. Checks if the action is on the absolute forbidden list
 * 2. Checks if the player is allowed under the server's whoCanCommand policy
 * 3. Checks if the player's role permits the specific skill
 */
export function canPlayerExecuteSkill(
  role: PlayerRole,
  policy: CommandPolicy,
  skillName: string,
): SkillAuthResult {
  const normSkill = skillName.trim();

  // 1. Never allowed forbidden actions (op, console, slash-commands, attacking players)
  if (FORBIDDEN_ACTIONS.has(normSkill.toLowerCase())) {
    return {
      allowed: false,
      reason: `Forbidden action "${normSkill}". Bots are strictly prohibited from console, op, and administrative actions.`,
    };
  }

  // 2. Check server-level command policy
  if (policy === 'owner_only' && role !== 'owner') {
    return {
      allowed: false,
      reason: `Command policy is set to "owner_only". Players with role "${role}" cannot command the bot.`,
    };
  }

  if (policy === 'trusted' && role === 'guest') {
    return {
      allowed: false,
      reason: `Command policy is set to "trusted". Guests cannot command the bot.`,
    };
  }

  // 3. Check role capability matrix
  const allowedSkills = ROLE_SKILL_PERMISSIONS[role];
  if (!allowedSkills || !allowedSkills.has(normSkill as SkillName)) {
    return {
      allowed: false,
      reason: `Permission denied: role "${role}" is not authorized to use skill "${normSkill}".`,
    };
  }

  return { allowed: true };
}
