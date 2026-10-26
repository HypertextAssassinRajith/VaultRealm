/**
 * Volume preparation for game servers.
 *
 * Prepares the persistent host storage directory for each game container,
 * ensures permissions, and guarantees path isolation within DATA_DIR.
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../config.js';
import type { GameTemplate } from './templates.js';

export function getServerDataDir(serverId: string): string {
  // Enforce serverId contains only safe characters
  if (!/^[a-zA-Z0-9_-]+$/.test(serverId)) {
    throw new Error(`Invalid serverId: ${serverId}`);
  }
  const config = getConfig();
  const baseDir = path.resolve(config.DATA_DIR, 'servers');
  const serverDir = path.resolve(baseDir, serverId);

  // Path jail check: ensure serverDir is strictly inside baseDir
  if (!serverDir.startsWith(baseDir + path.sep) && serverDir !== baseDir) {
    throw new Error('Path traversal detected in server directory resolution');
  }

  return serverDir;
}

/**
 * Prepares the host directory for the server container before start.
 */
export async function prepareServerVolume(serverId: string, template: GameTemplate): Promise<string> {
  const serverDir = getServerDataDir(serverId);

  try {
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true, mode: 0o755 });
    }

    // On Linux/Unix, if template specifies a non-root UID, chown the directory
    if (template.uid && process.platform !== 'win32' && process.getuid && process.getuid() === 0) {
      try {
        fs.chownSync(serverDir, template.uid, template.uid);
      } catch (err) {
        // Log warning if chown fails
        console.warn(`[volume] Failed to chown ${serverDir} to UID ${template.uid}:`, err);
      }
    }

    return serverDir;
  } catch (err) {
    const error = new Error(`Failed to prepare storage volume for server ${serverId}: ${err instanceof Error ? err.message : String(err)}`);
    (error as Error & { statusCode: number; code: string }).statusCode = 500;
    (error as Error & { statusCode: number; code: string }).code = 'VOLUME_PREP_FAILED';
    throw error;
  }
}
