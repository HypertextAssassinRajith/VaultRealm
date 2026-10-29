/**
 * Players & Moderation Management.
 *
 * Implements real-time player listing, kicking, player banning, and IP blocking/banning.
 * Reads persistent moderation state from server storage volume (banned-players.json, banned-ips.json, ops.json)
 * and executes live moderation commands via rcon-cli through the DockerDriver.
 */

import fs from 'node:fs';
import { getServerDataDir } from './volume.js';
import { safepath } from '../safepath.js';
import { executeServerCommand } from './console.js';
import { getServerDetail } from './service.js';

export interface BannedPlayer {
  uuid?: string;
  name: string;
  created?: string;
  source?: string;
  expires?: string;
  reason?: string;
}

export interface BannedIp {
  ip: string;
  created?: string;
  source?: string;
  expires?: string;
  reason?: string;
}

export interface ServerOp {
  uuid?: string;
  name: string;
  level?: number;
}

export interface ServerPlayersData {
  online: {
    count: number;
    max: number;
    players: string[];
  };
  bannedPlayers: BannedPlayer[];
  bannedIps: BannedIp[];
  ops: ServerOp[];
}

function readJsonFile<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Gets live online players and persistent moderation lists for a server.
 */
export async function getServerPlayersData(serverId: string, userId: string): Promise<ServerPlayersData> {
  const detail = await getServerDetail(serverId);
  const serverDir = getServerDataDir(serverId);

  // 1. Read persistent moderation files
  const bannedPlayersPath = safepath.resolve(serverDir, 'banned-players.json');
  const bannedIpsPath = safepath.resolve(serverDir, 'banned-ips.json');
  const opsPath = safepath.resolve(serverDir, 'ops.json');

  const bannedPlayers = readJsonFile<BannedPlayer>(bannedPlayersPath);
  const bannedIps = readJsonFile<BannedIp>(bannedIpsPath);
  const ops = readJsonFile<ServerOp>(opsPath);

  // 2. Fetch live online players via rcon if server is running
  let online = {
    count: 0,
    max: 20,
    players: [] as string[],
  };

  if (detail.status === 'running') {
    try {
      const res = await executeServerCommand(serverId, userId, 'list');
      // Format: "There are X of a max of Y players online: player1, player2"
      const match = res.output.match(/There are (\d+) of a max of (\d+) players online:?(.*)/i);
      if (match && match[1] && match[2]) {
        const count = Number(match[1]);
        const max = Number(match[2]);
        const rawPlayers = match[3] || '';
        const players = rawPlayers
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        online = { count, max, players };
      }
    } catch {
      // ignore rcon error when starting up
    }
  }

  return {
    online,
    bannedPlayers,
    bannedIps,
    ops,
  };
}

/**
 * Kicks a player from the running server.
 */
export async function kickPlayer(
  serverId: string,
  userId: string,
  player: string,
  reason?: string,
  ip?: string,
): Promise<{ success: boolean; message: string }> {
  const cleanPlayer = player.trim();
  if (!cleanPlayer) throw new Error('Player name is required');

  const cmd = `kick ${cleanPlayer}${reason ? ` ${reason.trim()}` : ''}`;
  const res = await executeServerCommand(serverId, userId, cmd, ip);
  return { success: true, message: res.output };
}

/**
 * Bans a player from the server.
 */
export async function banPlayer(
  serverId: string,
  userId: string,
  player: string,
  reason?: string,
  ip?: string,
): Promise<{ success: boolean; message: string }> {
  const cleanPlayer = player.trim();
  if (!cleanPlayer) throw new Error('Player name is required');

  const cmd = `ban ${cleanPlayer}${reason ? ` ${reason.trim()}` : ''}`;
  const res = await executeServerCommand(serverId, userId, cmd, ip);
  return { success: true, message: res.output };
}

/**
 * Unbans a player (pardon).
 */
export async function unbanPlayer(
  serverId: string,
  userId: string,
  player: string,
  ip?: string,
): Promise<{ success: boolean; message: string }> {
  const cleanPlayer = player.trim();
  if (!cleanPlayer) throw new Error('Player name is required');

  const cmd = `pardon ${cleanPlayer}`;
  const res = await executeServerCommand(serverId, userId, cmd, ip);
  return { success: true, message: res.output };
}

/**
 * Bans / blocks an IP address on the server.
 */
export async function banIp(
  serverId: string,
  userId: string,
  ipOrPlayer: string,
  reason?: string,
  ip?: string,
): Promise<{ success: boolean; message: string }> {
  const cleanTarget = ipOrPlayer.trim();
  if (!cleanTarget) throw new Error('IP address or player name is required');

  const cmd = `ban-ip ${cleanTarget}${reason ? ` ${reason.trim()}` : ''}`;
  const res = await executeServerCommand(serverId, userId, cmd, ip);
  return { success: true, message: res.output };
}

/**
 * Unbans an IP address (pardon-ip).
 */
export async function unbanIp(
  serverId: string,
  userId: string,
  targetIp: string,
  ip?: string,
): Promise<{ success: boolean; message: string }> {
  const cleanIp = targetIp.trim();
  if (!cleanIp) throw new Error('IP address is required');

  const cmd = `pardon-ip ${cleanIp}`;
  const res = await executeServerCommand(serverId, userId, cmd, ip);
  return { success: true, message: res.output };
}

/**
 * Grants or revokes operator permissions for a player.
 */
export async function setPlayerOp(
  serverId: string,
  userId: string,
  player: string,
  op: boolean,
  ip?: string,
): Promise<{ success: boolean; message: string }> {
  const cleanPlayer = player.trim();
  if (!cleanPlayer) throw new Error('Player name is required');

  const cmd = `${op ? 'op' : 'deop'} ${cleanPlayer}`;
  const res = await executeServerCommand(serverId, userId, cmd, ip);
  return { success: true, message: res.output };
}

