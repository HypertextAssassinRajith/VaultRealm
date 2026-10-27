/**
 * World Safety & Anti-Grief Engine for Companion Bot.
 *
 * Implements §9B.4 of IMPLEMENTATION_PLAN.md:
 * - Deny-list of blocks the bot will NEVER break or mine
 * - Container proximity guard (cannot break anything within 5 blocks of chests/containers)
 * - Protected zones (cannot break/place/fight inside designated radii)
 * - Absolute PvP ban: Bot can never attack a player entity, only hostile mobs.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ProtectedZone {
  name: string;
  center: Vec3;
  radius: number;
}

/**
 * Deny-list of blocks that the bot must NEVER break or mine under any circumstance.
 */
export const DENY_LIST_BLOCK_PATTERNS = [
  // Storage containers
  'chest',
  'trapped_chest',
  'ender_chest',
  'barrel',
  'shulker_box',
  'hopper',
  'dispenser',
  'dropper',

  // Signs & markers
  'sign',
  'hanging_sign',

  // Beds & spawners
  'bed',
  'spawner',
  'beacon',
  'conduit',

  // Redstone & doors
  'door',
  'trapdoor',
  'fence_gate',
  'repeater',
  'comparator',
  'piston',
  'sticky_piston',

  // Glass & decorative player builds
  'glass',
  'glass_pane',
  'stained_glass',
  'stained_glass_pane',

  // Unbreakable / admin blocks
  'bedrock',
  'barrier',
  'command_block',
  'chain_command_block',
  'repeating_command_block',
  'structure_block',
  'structure_void',
  'jigsaw',
  'end_portal_frame',
  'end_portal',
  'nether_portal',
];

/**
 * Known hostile and neutral Minecraft mobs that are valid targets for combat.
 * Note: 'player' is NEVER in this list.
 */
export const HOSTILE_MOBS = new Set([
  'zombie',
  'zombie_villager',
  'skeleton',
  'spider',
  'cave_spider',
  'creeper',
  'witch',
  'enderman',
  'drowned',
  'husk',
  'stray',
  'phantom',
  'pillager',
  'ravager',
  'vindicator',
  'evoker',
  'blaze',
  'ghast',
  'magma_cube',
  'slime',
  'piglin',
  'piglin_brute',
  'zombified_piglin',
  'wither_skeleton',
  'warden',
  'wither',
  'ender_dragon',
  'silverfish',
  'endermite',
  'guardian',
  'elder_guardian',
  'shulker',
  'hoglin',
  'zoglin',
]);

/**
 * Check if a block name matches the deny-list.
 */
export function isDenyListedBlock(blockName: string): boolean {
  const norm = blockName.toLowerCase().replace(/^minecraft:/, '');
  return DENY_LIST_BLOCK_PATTERNS.some((pattern) => {
    if (norm === pattern) return true;
    if (norm.endsWith(`_${pattern}`)) return true;
    if (norm.startsWith(`${pattern}_`)) return true;
    return false;
  });
}

/**
 * Calculate Euclidean distance between two 3D points.
 */
export function distance3d(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Check if a target position is within any configured protected zone.
 */
export function checkProtectedZone(
  pos: Vec3,
  zones: ProtectedZone[] = [],
): { isProtected: boolean; zoneName?: string } {
  for (const zone of zones) {
    const dist = distance3d(pos, zone.center);
    if (dist <= zone.radius) {
      return { isProtected: true, zoneName: zone.name };
    }
  }
  return { isProtected: false };
}

/**
 * Check if a block is within 5 blocks of a container (chest, barrel, etc.).
 *
 * Implements §9B.4: "anything within 5 blocks of a player-placed container".
 */
export function isNearContainer(
  targetPos: Vec3,
  nearbyContainers: Vec3[],
  radius = 5,
): boolean {
  for (const containerPos of nearbyContainers) {
    if (distance3d(targetPos, containerPos) <= radius) {
      return true;
    }
  }
  return false;
}

export interface MiningSafetyCheck {
  safe: boolean;
  reason?: string;
}

/**
 * Comprehensive check before the bot attempts to mine or break a block.
 */
export function checkBlockMiningSafety(
  blockName: string,
  blockPos: Vec3,
  options: {
    protectedZones?: ProtectedZone[];
    nearbyContainers?: Vec3[];
    containerProximityRadius?: number;
  } = {},
): MiningSafetyCheck {
  // 1. Direct deny-list check
  if (isDenyListedBlock(blockName)) {
    return {
      safe: false,
      reason: `Block "${blockName}" is on the safety deny-list (anti-grief protection).`,
    };
  }

  // 2. Protected zone check
  if (options.protectedZones && options.protectedZones.length > 0) {
    const zoneCheck = checkProtectedZone(blockPos, options.protectedZones);
    if (zoneCheck.isProtected) {
      return {
        safe: false,
        reason: `Position (${Math.round(blockPos.x)}, ${Math.round(blockPos.y)}, ${Math.round(blockPos.z)}) is inside protected zone "${zoneCheck.zoneName}".`,
      };
    }
  }

  // 3. Proximity to containers check
  if (options.nearbyContainers && options.nearbyContainers.length > 0) {
    const near = isNearContainer(
      blockPos,
      options.nearbyContainers,
      options.containerProximityRadius ?? 5,
    );
    if (near) {
      return {
        safe: false,
        reason: `Block is within 5 blocks of a chest or container. Mining near player storage is forbidden.`,
      };
    }
  }

  return { safe: true };
}

export interface AttackTargetSafetyCheck {
  safe: boolean;
  reason?: string;
}

/**
 * Strict combat target validator.
 *
 * PvP is categorically forbidden.
 * Bot may ONLY attack hostile or neutral mobs.
 */
export function checkAttackTargetSafety(
  targetType: string,
  targetName: string,
): AttackTargetSafetyCheck {
  const normType = targetType.trim().toLowerCase();
  const normName = targetName.trim().toLowerCase();

  // Category 1: Player check — ABSOLUTE PROHIBITION
  if (normType === 'player' || normName === 'player') {
    return {
      safe: false,
      reason: 'Attacking players is strictly forbidden. The bot will never engage in PvP.',
    };
  }

  // Category 2: Hostile mob check
  const mobType = normName.replace(/^minecraft:/, '');
  if (!HOSTILE_MOBS.has(mobType)) {
    return {
      safe: false,
      reason: `Target "${targetName}" is not a recognized hostile mob. The bot will not attack passive creatures or players.`,
    };
  }

  return { safe: true };
}
