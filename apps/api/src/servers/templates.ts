/**
 * Game server templates — data-only definitions with Zod validation.
 *
 * Templates define the Docker image, ports, env vars, default resources,
 * and startup/ready checks for each supported game.
 */

import { z } from 'zod';

export const templatePortSchema = z.object({
  name: z.string().min(1),
  containerPort: z.number().int().min(1).max(65535),
  protocol: z.enum(['tcp', 'udp']),
});

export type TemplatePort = z.infer<typeof templatePortSchema>;

export const templateEnvVarSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  default: z.string().optional(),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
  description: z.string().optional(),
});

export type TemplateEnvVar = z.infer<typeof templateEnvVarSchema>;

export const gameTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  image: z.string().min(1),
  minRamMb: z.number().int().positive(),
  defaultRamMb: z.number().int().positive(),
  defaultCpu: z.number().positive(),
  defaultDiskMb: z.number().int().positive(),
  ports: z.array(templatePortSchema).min(1),
  env: z.array(templateEnvVarSchema),
  dataDir: z.string().min(1),
  stopCommand: z.string().optional(),
  stopTimeout: z.number().int().min(1).default(15),
  readyLogRegex: z.string().optional(),
  readyTimeoutSec: z.number().int().min(1).default(300),
  uid: z.number().int().optional(),
  rcon: z
    .object({
      port: z.number().int(),
      passwordEnv: z.string(),
    })
    .optional(),
});

export type GameTemplate = z.infer<typeof gameTemplateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Built-in templates
// ─────────────────────────────────────────────────────────────────────────────

const RAW_TEMPLATES: GameTemplate[] = [
  {
    id: 'minecraft-java',
    name: 'Minecraft Java',
    description: 'Vanilla/Paper Minecraft Java Edition server (itzg/minecraft-server)',
    category: 'Sandbox',
    image: 'itzg/minecraft-server:latest',
    minRamMb: 1024,
    defaultRamMb: 2048,
    defaultCpu: 2,
    defaultDiskMb: 10240,
    ports: [
      { name: 'Game', containerPort: 25565, protocol: 'tcp' },
      { name: 'RCON', containerPort: 25575, protocol: 'tcp' },
    ],
    env: [
      { key: 'EULA', label: 'Accept EULA', default: 'TRUE', required: true },
      { key: 'TYPE', label: 'Server type (PAPER, FABRIC, FORGE, VANILLA)', default: 'PAPER' },
      { key: 'VERSION', label: 'Minecraft version', default: 'LATEST' },
      { key: 'MEMORY', label: 'Java heap (auto-set)', default: '' },
      { key: 'MOTD', label: 'Message of the day', default: 'A VaultRealm Minecraft Server' },
      { key: 'MAX_PLAYERS', label: 'Max players', default: '20' },
      { key: 'DIFFICULTY', label: 'Difficulty', default: 'normal' },
      { key: 'MODE', label: 'Game mode', default: 'survival' },
      { key: 'ENABLE_RCON', label: 'Enable RCON', default: 'true' },
      { key: 'RCON_PASSWORD', label: 'RCON password', default: '', secret: true },
    ],
    dataDir: '/data',
    stopCommand: 'stop',
    stopTimeout: 30,
    readyLogRegex: 'Done \\(.*s\\)! For help, type',
    readyTimeoutSec: 300,
    rcon: { port: 25575, passwordEnv: 'RCON_PASSWORD' },
    uid: 1000,
  },
  {
    id: 'minecraft-bedrock',
    name: 'Minecraft Bedrock',
    description: 'Minecraft Bedrock Edition server',
    category: 'Sandbox',
    image: 'itzg/minecraft-bedrock-server:latest',
    minRamMb: 512,
    defaultRamMb: 1024,
    defaultCpu: 1,
    defaultDiskMb: 5120,
    ports: [
      { name: 'Game', containerPort: 19132, protocol: 'udp' },
    ],
    env: [
      { key: 'EULA', label: 'Accept EULA', default: 'TRUE', required: true },
      { key: 'SERVER_NAME', label: 'Server name', default: 'VaultRealm Bedrock' },
      { key: 'GAMEMODE', label: 'Game mode', default: 'survival' },
      { key: 'DIFFICULTY', label: 'Difficulty', default: 'normal' },
      { key: 'MAX_PLAYERS', label: 'Max players', default: '10' },
    ],
    dataDir: '/data',
    stopCommand: 'stop',
    stopTimeout: 15,
    readyLogRegex: 'Server started\\.',
    readyTimeoutSec: 180,
    uid: 1000,
  },
  {
    id: 'valheim',
    name: 'Valheim',
    description: 'Valheim dedicated server',
    category: 'Survival',
    image: 'lloesche/valheim-server:latest',
    minRamMb: 2048,
    defaultRamMb: 4096,
    defaultCpu: 2,
    defaultDiskMb: 10240,
    ports: [
      { name: 'Game', containerPort: 2456, protocol: 'udp' },
      { name: 'Game+1', containerPort: 2457, protocol: 'udp' },
    ],
    env: [
      { key: 'SERVER_NAME', label: 'Server name', default: 'VaultRealm Valheim' },
      { key: 'WORLD_NAME', label: 'World name', default: 'VaultRealm' },
      { key: 'SERVER_PASS', label: 'Server password', default: '', secret: true, required: true },
    ],
    dataDir: '/config',
    stopTimeout: 30,
    readyLogRegex: 'Game server connected',
    readyTimeoutSec: 300,
    uid: 1000,
  },
  {
    id: 'palworld',
    name: 'Palworld',
    description: 'Palworld dedicated server (Warning: High RAM usage)',
    category: 'Survival',
    image: 'thijsvanloef/palworld-server-docker:latest',
    minRamMb: 8192,
    defaultRamMb: 12288,
    defaultCpu: 4,
    defaultDiskMb: 20480,
    ports: [
      { name: 'Game', containerPort: 8211, protocol: 'udp' },
      { name: 'RCON', containerPort: 25575, protocol: 'tcp' },
    ],
    env: [
      { key: 'SERVER_NAME', label: 'Server name', default: 'VaultRealm Palworld' },
      { key: 'ADMIN_PASSWORD', label: 'Admin password', default: '', secret: true },
      { key: 'SERVER_PASSWORD', label: 'Server password', default: '' },
      { key: 'PLAYERS', label: 'Max players', default: '16' },
    ],
    dataDir: '/palworld',
    stopTimeout: 30,
    readyLogRegex: 'App startup complete',
    readyTimeoutSec: 360,
    rcon: { port: 25575, passwordEnv: 'ADMIN_PASSWORD' },
    uid: 1000,
  },
  {
    id: 'terraria',
    name: 'Terraria',
    description: 'Terraria dedicated server via TShock',
    category: 'Sandbox',
    image: 'ryshe/terraria:latest',
    minRamMb: 512,
    defaultRamMb: 1024,
    defaultCpu: 1,
    defaultDiskMb: 2048,
    ports: [
      { name: 'Game', containerPort: 7777, protocol: 'tcp' },
    ],
    env: [
      { key: 'WORLD_FILENAME', label: 'World filename', default: 'VaultRealm.wld' },
      { key: 'AUTOCREATE', label: 'Auto-create world size (1=small, 2=medium, 3=large)', default: '2' },
    ],
    dataDir: '/root/.local/share/Terraria/Worlds',
    stopCommand: 'exit',
    stopTimeout: 15,
    readyLogRegex: 'Listening on port',
    readyTimeoutSec: 180,
  },
];

// Validate all built-in templates with the Zod schema
export const TEMPLATES: GameTemplate[] = RAW_TEMPLATES.map((t) => gameTemplateSchema.parse(t));

// ── Template registry ────────────────────────────────────────────────────────

const templateMap = new Map<string, GameTemplate>();
for (const t of TEMPLATES) {
  templateMap.set(t.id, t);
}

export function getTemplate(id: string): GameTemplate | undefined {
  return templateMap.get(id);
}

/**
 * Calculates the JVM heap size (-Xmx / MEMORY) in MB for a Minecraft container,
 * reserving necessary headroom for JVM Metaspace, GC structures, and native threads
 * so the container does not get killed by the Linux cgroup OOM killer.
 */
export function calculateMinecraftHeapMb(ramMb: number): number {
  if (ramMb <= 1024) {
    return Math.max(512, ramMb - 256);
  }
  if (ramMb <= 2048) {
    return Math.max(1024, ramMb - 512); // e.g., 2048 -> 1536M
  }
  if (ramMb <= 4096) {
    return ramMb - 768; // e.g., 3072 -> 2304M, 4096 -> 3328M
  }
  // For large allocations (>4GB), reserve 20% capped at 2048MB headroom
  const headroom = Math.min(2048, Math.round((ramMb * 0.2) / 256) * 256);
  return ramMb - headroom;
}

export function getAllTemplates(): GameTemplate[] {
  return [...TEMPLATES];
}

export function getTemplateIds(): string[] {
  return TEMPLATES.map((t) => t.id);
}

/**
 * Returns a JSON-schema friendly representation for client forms.
 */
export function getTemplatesSummary(): Array<{
  id: string;
  name: string;
  description: string;
  category: string;
  minRamMb: number;
  defaultRamMb: number;
  ports: TemplatePort[];
  env: TemplateEnvVar[];
}> {
  return TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    minRamMb: t.minRamMb,
    defaultRamMb: t.defaultRamMb,
    ports: t.ports,
    env: t.env.map((e) => ({
      key: e.key,
      label: e.label,
      default: e.secret ? undefined : e.default,
      required: e.required,
      secret: e.secret,
      description: e.description,
    })),
  }));
}
