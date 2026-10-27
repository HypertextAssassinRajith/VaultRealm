/**
 * Auto-Spawn & Hysteresis Engine for AI Companion.
 *
 * Implements §9B.6 of IMPLEMENTATION_PLAN.md:
 * - Spawn modes: 'off', 'manual', 'auto-solo', 'always'
 * - 'auto-solo':
 *   - Polls player count (excluding bot)
 *   - Exactly 1 real player for >= 20s -> spawn bot
 *   - >= 2 real players for >= 60s -> despawn bot (farewell)
 *   - 0 players -> despawn immediately (so server can idle-stop)
 *   - Hysteresis: '!leave' command pauses auto-spawn for 2 hours (120 min)
 * - Chat summon:
 *   - Panel tails server log and triggers spawn on '!buddy'
 */

export interface AutoSpawnState {
  serverId: string;
  consecutiveSoloSeconds: number;
  consecutiveMultiSeconds: number;
  pauseUntil: number | null; // Timestamp ms when pause expires
}

export type AutoSpawnAction =
  | { action: 'none' }
  | { action: 'spawn'; reason: string }
  | { action: 'despawn'; reason: string };

const serverStates = new Map<string, AutoSpawnState>();

/**
 * Get or initialize tracking state for a server.
 */
export function getAutoSpawnState(serverId: string): AutoSpawnState {
  let state = serverStates.get(serverId);
  if (!state) {
    state = {
      serverId,
      consecutiveSoloSeconds: 0,
      consecutiveMultiSeconds: 0,
      pauseUntil: null,
    };
    serverStates.set(serverId, state);
  }
  return state;
}

/**
 * Pause auto-spawn for a given duration (default: 2 hours).
 * Triggered by `!leave` command or user action.
 */
export function pauseAutoSpawn(serverId: string, durationMs = 2 * 3600_000): void {
  const state = getAutoSpawnState(serverId);
  state.pauseUntil = Date.now() + durationMs;
  state.consecutiveSoloSeconds = 0;
  state.consecutiveMultiSeconds = 0;
}

/**
 * Reset auto-spawn state (e.g. for testing or on server reboot).
 */
export function resetAutoSpawnState(serverId?: string): void {
  if (serverId) {
    serverStates.delete(serverId);
  } else {
    serverStates.clear();
  }
}

/**
 * Evaluate auto-spawn condition based on player count and elapsed interval.
 *
 * @param serverId Server identifier
 * @param realPlayerCount Number of active players EXCLUDING the bot
 * @param botStatus Current bot status ('offline' | 'joining' | 'online' | 'error')
 * @param mode Configured bot mode ('off' | 'manual' | 'auto-solo' | 'always')
 * @param intervalSeconds Seconds elapsed since last check (typically 10s)
 */
export function evaluateAutoSpawn(
  serverId: string,
  realPlayerCount: number,
  botStatus: 'offline' | 'joining' | 'online' | 'error',
  mode: 'off' | 'manual' | 'auto-solo' | 'always',
  intervalSeconds = 10,
): AutoSpawnAction {
  // Mode: off -> never act
  if (mode === 'off') {
    return { action: 'none' };
  }

  // Mode: always -> keep spawned while server is running
  if (mode === 'always') {
    if (botStatus === 'offline' || botStatus === 'error') {
      return { action: 'spawn', reason: 'Bot mode is set to "always".' };
    }
    return { action: 'none' };
  }

  // Mode: manual -> handled by explicit user button or chat summon '!buddy'
  if (mode === 'manual') {
    return { action: 'none' };
  }

  // Mode: auto-solo
  const state = getAutoSpawnState(serverId);

  // Check hysteresis pause (e.g. !leave command)
  if (state.pauseUntil && Date.now() < state.pauseUntil) {
    return { action: 'none' };
  } else if (state.pauseUntil) {
    state.pauseUntil = null; // Expired
  }

  // Case 1: 0 players -> despawn immediately so server can auto-stop (§11)
  if (realPlayerCount === 0) {
    state.consecutiveSoloSeconds = 0;
    state.consecutiveMultiSeconds = 0;
    if (botStatus === 'online' || botStatus === 'joining') {
      return { action: 'despawn', reason: '0 players on server; despawning for server idle stop.' };
    }
    return { action: 'none' };
  }

  // Case 2: Exactly 1 real player -> accumulate solo seconds
  if (realPlayerCount === 1) {
    state.consecutiveMultiSeconds = 0;
    state.consecutiveSoloSeconds += intervalSeconds;

    // Solo for >= 20 seconds -> spawn bot
    if (state.consecutiveSoloSeconds >= 20) {
      if (botStatus === 'offline' || botStatus === 'error') {
        return {
          action: 'spawn',
          reason: `1 player on server for ${state.consecutiveSoloSeconds}s (threshold: 20s).`,
        };
      }
    }
    return { action: 'none' };
  }

  // Case 3: >= 2 real players -> accumulate multi seconds
  if (realPlayerCount >= 2) {
    state.consecutiveSoloSeconds = 0;
    state.consecutiveMultiSeconds += intervalSeconds;

    // >= 2 players for >= 60 seconds -> despawn bot (farewell)
    if (state.consecutiveMultiSeconds >= 60) {
      if (botStatus === 'online' || botStatus === 'joining') {
        return {
          action: 'despawn',
          reason: `${realPlayerCount} players on server for ${state.consecutiveMultiSeconds}s (threshold: 60s); companion bids farewell.`,
        };
      }
    }
    return { action: 'none' };
  }

  return { action: 'none' };
}

/**
 * Check if a server log line contains a chat summon for the companion ('!buddy').
 * Supports standard Minecraft server log chat formats:
 * `<Player> !buddy` or `[Not Secure] <Player> !buddy`
 */
export function checkChatSummon(
  logLine: string,
  botName = 'Buddy',
): { isSummon: boolean; player?: string } {
  // Regex matches: `<Username> !buddy` or `<Username> !buddy summon`
  const summonPattern = new RegExp(`<(.*?)>\\s*!(?:buddy|${botName.toLowerCase()})\\b`, 'i');
  const match = logLine.match(summonPattern);
  if (match && match[1]) {
    return { isSummon: true, player: match[1].trim() };
  }
  return { isSummon: false };
}
