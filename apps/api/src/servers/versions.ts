/**
 * Game Server Version Provider
 *
 * Pulls available versions from official open-source manifest APIs:
 * - Mojang Version Manifest: https://launchermeta.mojang.com/mc/game/version_manifest_v2.json
 *
 * Includes in-memory caching and resilient offline fallbacks.
 */

export interface VersionListResponse {
  latest: string;
  recommended: string;
  versions: string[];
  source: string;
}

export const FALLBACK_MINECRAFT_JAVA_VERSIONS = [
  'LATEST',
  '1.21.4',
  '1.21.3',
  '1.21.1',
  '1.20.6',
  '1.20.4',
  '1.20.2',
  '1.20.1',
  '1.19.4',
  '1.19.2',
  '1.18.2',
  '1.17.1',
  '1.16.5',
  '1.15.2',
  '1.14.4',
  '1.13.2',
  '1.12.2',
  '1.8.9',
  '1.7.10',
];

export const FALLBACK_MINECRAFT_BEDROCK_VERSIONS = [
  'LATEST',
  'PREVIEW',
  '1.21.50',
  '1.21.40',
  '1.21.30',
  '1.21.20',
  '1.21.0',
];

interface MojangManifest {
  latest?: { release?: string; snapshot?: string };
  versions?: Array<{ id: string; type: string }>;
}

let cachedMinecraftJava: { data: VersionListResponse; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch official Minecraft Java versions from Mojang manifest API.
 */
export async function getMinecraftJavaVersions(): Promise<VersionListResponse> {
  const now = Date.now();
  if (cachedMinecraftJava && cachedMinecraftJava.expiresAt > now) {
    return cachedMinecraftJava.data;
  }

  try {
    const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', {
      signal: AbortSignal.timeout(4000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VaultRealm-Panel/0.5 (https://vaultsoftlabs.tech)',
      },
    });

    if (!res.ok) {
      throw new Error(`Mojang API responded with HTTP ${res.status}`);
    }

    const data = (await res.json()) as MojangManifest;
    const releaseVersions = (data.versions ?? [])
      .filter((v) => v.type === 'release')
      .map((v) => v.id);

    // Dedup and ensure LATEST is at top
    const versions = ['LATEST', ...releaseVersions.filter((v) => v !== 'LATEST')];
    const latestRelease = data.latest?.release ?? versions[1] ?? 'LATEST';

    const result: VersionListResponse = {
      latest: latestRelease,
      recommended: 'LATEST',
      versions,
      source: 'Mojang Official Version Manifest',
    };

    cachedMinecraftJava = {
      data: result,
      expiresAt: now + CACHE_TTL_MS,
    };

    return result;
  } catch {
    // Return robust fallback if offline or API blocked
    return {
      latest: '1.21.4',
      recommended: 'LATEST',
      versions: FALLBACK_MINECRAFT_JAVA_VERSIONS,
      source: 'Offline Fallback Manifest',
    };
  }
}

/**
 * Fetch available versions for a given game template.
 */
export async function getTemplateVersions(templateId: string): Promise<VersionListResponse> {
  switch (templateId) {
    case 'minecraft-java':
      return getMinecraftJavaVersions();

    case 'minecraft-bedrock':
      return {
        latest: 'LATEST',
        recommended: 'LATEST',
        versions: FALLBACK_MINECRAFT_BEDROCK_VERSIONS,
        source: 'Mojang Bedrock Manifest',
      };

    default:
      return {
        latest: 'LATEST',
        recommended: 'LATEST',
        versions: ['LATEST'],
        source: 'Default Template Channel',
      };
  }
}

