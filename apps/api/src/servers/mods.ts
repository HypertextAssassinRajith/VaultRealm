/**
 * Mods and plugins manager for game servers.
 *
 * Interacts with the server's storage volume using safepath.resolve().
 * Supports listing, downloading from Modrinth / trusted URLs, toggling (.disabled), and deletion.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getServerDataDir } from './volume.js';
import { safepath } from '../safepath.js';

export interface InstalledMod {
  filename: string;
  sizeBytes: number;
  enabled: boolean;
  modifiedAt: string;
}

export function getAddonsFolder(templateId: string): string {
  // Paper, Purpur, Spigot use 'plugins', while Fabric, Forge, NeoForge, Quilt use 'mods'
  const isPluginServer = ['paper', 'spigot', 'purpur'].some((k) => templateId.toLowerCase().includes(k));
  return isPluginServer ? 'plugins' : 'mods';
}

export function getModsDirectory(serverId: string, templateId: string): string {
  const serverDir = getServerDataDir(serverId);
  const folderName = getAddonsFolder(templateId);
  const modsDir = safepath.resolve(serverDir, folderName);
  if (!fs.existsSync(modsDir)) {
    fs.mkdirSync(modsDir, { recursive: true, mode: 0o777 });
  }
  return modsDir;
}

export async function listInstalledMods(serverId: string, templateId: string): Promise<InstalledMod[]> {
  const modsDir = getModsDirectory(serverId, templateId);
  if (!fs.existsSync(modsDir)) {
    return [];
  }

  const entries = await fs.promises.readdir(modsDir, { withFileTypes: true });
  const result: InstalledMod[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const isJar = entry.name.endsWith('.jar');
    const isDisabledJar = entry.name.endsWith('.jar.disabled');

    if (!isJar && !isDisabledJar) continue;

    try {
      const filePath = safepath.resolve(modsDir, entry.name);
      const stats = await fs.promises.stat(filePath);

      result.push({
        filename: entry.name,
        sizeBytes: stats.size,
        enabled: isJar,
        modifiedAt: stats.mtime.toISOString(),
      });
    } catch {
      // Ignore files that can't be stat-ed
    }
  }

  // Sort alphabetically
  return result.sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function installModFromUrl(
  serverId: string,
  templateId: string,
  downloadUrl: string,
  rawFilename: string,
): Promise<{ filename: string; sizeBytes: number }> {
  // Validate URL protocol
  const parsed = new URL(downloadUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const error = new Error('Invalid download URL: protocol must be HTTP or HTTPS');
    (error as Error & { code: string; statusCode: number }).code = 'INVALID_PROTOCOL';
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  // Clean filename and ensure it ends with .jar
  let filename = path.basename(rawFilename).replace(/[^a-zA-Z0-9_\-.+]/g, '_');
  if (!filename.endsWith('.jar')) {
    filename += '.jar';
  }

  const modsDir = getModsDirectory(serverId, templateId);
  const targetPath = safepath.resolve(modsDir, filename);

  const res = await fetch(downloadUrl, {
    headers: {
      'User-Agent': 'VaultRealm-Panel/0.5 (https://vaultsoftlabs.tech)',
    },
    signal: AbortSignal.timeout(30000), // 30s timeout
  });

  if (!res.ok) {
    const error = new Error(`Failed to download mod from remote server: HTTP ${res.status}`);
    (error as Error & { code: string; statusCode: number }).code = 'DOWNLOAD_FAILED';
    (error as Error & { statusCode: number }).statusCode = 502;
    throw error;
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await fs.promises.writeFile(targetPath, buffer);

  return {
    filename,
    sizeBytes: buffer.length,
  };
}

export async function toggleMod(
  serverId: string,
  templateId: string,
  filename: string,
  enable: boolean,
): Promise<{ newFilename: string; enabled: boolean }> {
  const modsDir = getModsDirectory(serverId, templateId);
  const currentPath = safepath.resolve(modsDir, filename);

  if (!fs.existsSync(currentPath)) {
    const error = new Error(`Mod file not found: ${filename}`);
    (error as Error & { code: string; statusCode: number }).code = 'NOT_FOUND';
    (error as Error & { statusCode: number }).statusCode = 404;
    throw error;
  }

  let newFilename = filename;
  if (enable && filename.endsWith('.jar.disabled')) {
    newFilename = filename.replace(/\.disabled$/, '');
  } else if (!enable && filename.endsWith('.jar')) {
    newFilename = `${filename}.disabled`;
  }

  if (newFilename !== filename) {
    const newPath = safepath.resolve(modsDir, newFilename);
    await fs.promises.rename(currentPath, newPath);
  }

  return {
    newFilename,
    enabled: enable,
  };
}

export async function deleteMod(
  serverId: string,
  templateId: string,
  filename: string,
): Promise<void> {
  const modsDir = getModsDirectory(serverId, templateId);
  const filePath = safepath.resolve(modsDir, filename);

  if (!fs.existsSync(filePath)) {
    const error = new Error(`Mod file not found: ${filename}`);
    (error as Error & { code: string; statusCode: number }).code = 'NOT_FOUND';
    (error as Error & { statusCode: number }).statusCode = 404;
    throw error;
  }

  await fs.promises.unlink(filePath);
}
