/**
 * World Perception Snapshot Generator for Companion Bot.
 *
 * Implements §9B.4 of IMPLEMENTATION_PLAN.md:
 * Each turn the LLM receives a compact text snapshot (not raw block bytes):
 * - position, dimension, time/weather
 * - health/hunger, held item, equipped armor
 * - inventory summary
 * - nearby players and mobs (≤16 blocks)
 * - notable nearby blocks (ores, chest, bed, water/lava)
 * - current task and last result
 * - saved places
 * - recent chat lines
 */

import type { Vec3 } from './safety.js';

export interface EntitySummary {
  name: string;
  type: string;
  distance: number;
  health?: number;
  heldItem?: string;
}

export interface BlockSummary {
  name: string;
  x: number;
  y: number;
  z: number;
  distance: number;
}

export interface InventoryItemSummary {
  name: string;
  count: number;
}

export interface BotPerceptionInput {
  botName: string;
  position: Vec3;
  dimension?: string;
  timeOfDay?: 'day' | 'night' | 'sunset' | 'sunrise' | string;
  weather?: 'clear' | 'rain' | 'thunder' | string;
  health: number;
  maxHealth?: number;
  food: number;
  heldItem?: string | null;
  armor?: {
    head?: string | null;
    torso?: string | null;
    legs?: string | null;
    feet?: string | null;
  };
  inventory: InventoryItemSummary[];
  nearbyPlayers: EntitySummary[];
  nearbyMobs: EntitySummary[];
  notableBlocks: BlockSummary[];
  currentTask?: string | null;
  lastActionResult?: string | null;
  savedPlaces?: Record<string, Vec3>;
  recentChat?: Array<{ username: string; message: string }>;
}

/**
 * Generate a concise, structured snapshot string suitable for the LLM system prompt.
 */
export function buildPerceptionSnapshot(data: BotPerceptionInput): string {
  const lines: string[] = [];

  // 1. Status & Coordinates
  const posStr = `(${Math.round(data.position.x)}, ${Math.round(data.position.y)}, ${Math.round(data.position.z)})`;
  const dim = data.dimension ?? 'overworld';
  const time = data.timeOfDay ?? 'day';
  const weather = data.weather ?? 'clear';
  lines.push(`[LOCATION] Pos: ${posStr} | Dim: ${dim} | Time: ${time} | Weather: ${weather}`);

  // 2. Health & Vitals
  const healthStr = `${Math.round(data.health)}/${data.maxHealth ?? 20}`;
  const foodStr = `${Math.round(data.food)}/20`;
  const held = data.heldItem ?? 'empty';
  lines.push(`[VITALS] Health: ${healthStr} | Food: ${foodStr} | Main Hand: ${held}`);

  // 3. Armor (if equipped)
  if (data.armor && (data.armor.head || data.armor.torso || data.armor.legs || data.armor.feet)) {
    const armorPieces: string[] = [];
    if (data.armor.head) armorPieces.push(`Head: ${data.armor.head}`);
    if (data.armor.torso) armorPieces.push(`Chest: ${data.armor.torso}`);
    if (data.armor.legs) armorPieces.push(`Legs: ${data.armor.legs}`);
    if (data.armor.feet) armorPieces.push(`Feet: ${data.armor.feet}`);
    lines.push(`[ARMOR] ${armorPieces.join(' | ')}`);
  }

  // 4. Inventory Summary
  if (data.inventory.length === 0) {
    lines.push(`[INVENTORY] Empty`);
  } else {
    const invItems = data.inventory
      .map((i) => `${i.count}x ${i.name.replace(/^minecraft:/, '')}`)
      .join(', ');
    lines.push(`[INVENTORY] ${invItems}`);
  }

  // 5. Nearby Players (≤16 blocks)
  if (data.nearbyPlayers.length === 0) {
    lines.push(`[NEARBY PLAYERS] None`);
  } else {
    const playersStr = data.nearbyPlayers
      .map((p) => `${p.name} (${Math.round(p.distance)}m away${p.heldItem ? `, holding ${p.heldItem}` : ''})`)
      .join(', ');
    lines.push(`[NEARBY PLAYERS] ${playersStr}`);
  }

  // 6. Nearby Mobs (≤16 blocks)
  if (data.nearbyMobs.length === 0) {
    lines.push(`[NEARBY MOBS] None`);
  } else {
    const mobsStr = data.nearbyMobs
      .slice(0, 8) // Limit to top 8 to avoid prompt bloating
      .map((m) => `${m.name} (${Math.round(m.distance)}m)`)
      .join(', ');
    lines.push(`[NEARBY MOBS] ${mobsStr}`);
  }

  // 7. Notable Nearby Blocks (≤16 blocks: ores, chests, beds, lava, water)
  if (data.notableBlocks.length > 0) {
    const blocksStr = data.notableBlocks
      .slice(0, 8)
      .map((b) => `${b.name.replace(/^minecraft:/, '')} at (${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.z)}, ${Math.round(b.distance)}m)`)
      .join(' | ');
    lines.push(`[NEARBY BLOCKS] ${blocksStr}`);
  }

  // 8. Saved Places
  if (data.savedPlaces && Object.keys(data.savedPlaces).length > 0) {
    const places = Object.entries(data.savedPlaces)
      .map(([name, pos]) => `${name}: (${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)})`)
      .join(', ');
    lines.push(`[SAVED PLACES] ${places}`);
  }

  // 9. Current Task & Last Result
  if (data.currentTask) {
    lines.push(`[CURRENT TASK] ${data.currentTask}`);
  }
  if (data.lastActionResult) {
    lines.push(`[LAST ACTION RESULT] ${data.lastActionResult}`);
  }

  // 10. Recent Chat
  if (data.recentChat && data.recentChat.length > 0) {
    const chatSnippet = data.recentChat
      .slice(-5)
      .map((c) => `<${c.username}> ${c.message}`)
      .join(' | ');
    lines.push(`[RECENT CHAT] ${chatSnippet}`);
  }

  return lines.join('\n');
}
