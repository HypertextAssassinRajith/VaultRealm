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
      fs.mkdirSync(serverDir, { recursive: true, mode: 0o777 });
    }
    try {
      fs.chmodSync(serverDir, 0o777);
    } catch {
      // Ignore if filesystem driver does not support chmod
    }

    // On Linux/Unix, if template specifies a target UID (or defaults to 1000), chown the directory
    const targetUid = template.uid ?? 1000;
    if (process.platform !== 'win32' && process.getuid && process.getuid() === 0) {
      try {
        fs.chownSync(serverDir, targetUid, targetUid);
      } catch (err) {
        // Log warning if chown fails
        console.warn(`[volume] Failed to chown ${serverDir} to UID ${targetUid}:`, err);
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

/**
 * Calculates current disk usage of the server data directory in MB.
 */
export function getServerDiskUsage(serverId: string, diskLimitMb = 10240): {
  diskUsedMb: number;
  diskLimitMb: number;
  diskPercent: number;
} {
  try {
    const serverDir = getServerDataDir(serverId);
    if (!fs.existsSync(serverDir)) {
      return { diskUsedMb: 0, diskLimitMb, diskPercent: 0 };
    }

    let totalBytes = 0;
    const stack = [serverDir];
    let fileCount = 0;

    // Fast iterative traversal to sum file sizes
    while (stack.length > 0 && fileCount < 10000) {
      const current = stack.pop()!;
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            stack.push(fullPath);
          } else if (entry.isFile()) {
            fileCount++;
            try {
              totalBytes += fs.statSync(fullPath).size;
            } catch {
              // ignore locked or transient file
            }
          }
        }
      } catch {
        // ignore unreadable dir
      }
    }

    const diskUsedMb = Math.round((totalBytes / (1024 * 1024)) * 100) / 100;
    const diskPercent = diskLimitMb > 0 ? Math.min(100, Math.round((diskUsedMb / diskLimitMb) * 1000) / 10) : 0;
    return { diskUsedMb, diskLimitMb, diskPercent };
  } catch {
    return { diskUsedMb: 0, diskLimitMb, diskPercent: 0 };
  }
}
