/**
 * Debug bundle generator with secret redaction.
 *
 * Implements §9.4 of IMPLEMENTATION_PLAN.md:
 * Generates a downloadable ZIP archive containing:
 * - inspect.json (container inspect with secrets redacted)
 * - logs.txt (last 2000 log lines)
 * - events.json (lifecycle & debug events)
 * - stats.json (resource usage snapshot)
 * - template.json (template definition with env secrets scrubbed)
 * - host.json (host specs and memory budget)
 */

import os from 'os';
import { eq, desc } from 'drizzle-orm';
import { getDatabase } from '../db/index.js';
import { servers, events } from '../db/schema.js';
import { getDockerDriver } from './service.js';
import { getTemplate } from './templates.js';
import { getHostCapacityStatus } from './quota.js';

// CRC32 table for ZIP creation
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function calculateCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFileEntry {
  name: string;
  data: Buffer;
}

/**
 * Creates a valid ZIP archive buffer in memory without external dependencies.
 */
export function createZipArchive(files: ZipFileEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf-8');
    const crc = calculateCrc32(file.data);
    const size = file.data.length;

    // Local file header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(0, 8); // Compression method (0 = stored / uncompressed)
    localHeader.writeUInt16LE(0, 10); // Last mod file time
    localHeader.writeUInt16LE(0, 12); // Last mod file date
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(size, 18); // Compressed size
    localHeader.writeUInt32LE(size, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, file.data);

    // Central directory header (46 bytes + name length)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory file header signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed to extract
    centralHeader.writeUInt16LE(0, 8); // General purpose bit flag
    centralHeader.writeUInt16LE(0, 10); // Compression method
    centralHeader.writeUInt16LE(0, 12); // Last mod file time
    centralHeader.writeUInt16LE(0, 14); // Last mod file date
    centralHeader.writeUInt32LE(crc, 16); // CRC-32
    centralHeader.writeUInt32LE(size, 20); // Compressed size
    centralHeader.writeUInt32LE(size, 24); // Uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(offset, 42); // Relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + file.data.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) {
    centralDirSize += ch.length;
  }

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(files.length, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(files.length, 10); // Total number of central directory records
  eocd.writeUInt32LE(centralDirSize, 12); // Size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/**
 * Redacts secret environment variables and passwords.
 */
export function redactSecrets(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // Redact tokens/passwords in strings
    return obj.replace(/(password|secret|token|key)=([^\s&]+)/gi, '$1=[REDACTED]');
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (/password|secret|token|key|rcon/i.test(k)) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = redactSecrets(v);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Builds the complete debug bundle for a server.
 */
export async function generateDebugBundle(serverId: string): Promise<Buffer> {
  const db = getDatabase();
  const driver = getDockerDriver();

  const server = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const template = getTemplate(server.templateId);
  const host = getHostCapacityStatus();

  // 1. Logs
  let logsText = 'No container logs available.\n';
  if (server.containerId) {
    try {
      const logLines = await driver.getContainerLogs(server.containerId, 2000);
      logsText = logLines.join('\n');
    } catch (err) {
      logsText = `Error fetching logs: ${err instanceof Error ? err.message : String(err)}\n`;
    }
  }

  // 2. Container inspect with secrets scrubbed
  let inspectData: unknown = { status: 'no_container' };
  if (server.containerId) {
    try {
      const rawInspect = await driver.inspectContainer(server.containerId);
      // Redact env vars in inspect data
      const sanitizedEnv = rawInspect.config.env.map((e) => {
        const [k] = e.split('=');
        if (/password|secret|token|key|rcon/i.test(k || '')) {
          return `${k}=[REDACTED]`;
        }
        return e;
      });
      inspectData = {
        ...rawInspect,
        config: {
          ...rawInspect.config,
          env: sanitizedEnv,
        },
      };
    } catch (err) {
      inspectData = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 3. Stats snapshot
  let statsData: unknown = { status: 'not_running' };
  if (server.containerId && server.status === 'running') {
    try {
      statsData = await driver.getContainerStats(server.containerId);
    } catch {
      // not running
    }
  }

  // 4. Events timeline
  const serverEvents = db
    .select()
    .from(events)
    .where(eq(events.serverId, serverId))
    .orderBy(desc(events.ts))
    .limit(200)
    .all();

  // 5. Template and server configuration with secrets redacted
  const rawEnv = JSON.parse(server.envJson || '{}') as Record<string, string>;
  const sanitizedServerEnv = redactSecrets(rawEnv);

  const templateData = {
    template: template
      ? {
          id: template.id,
          name: template.name,
          image: template.image,
          minRamMb: template.minRamMb,
          defaultRamMb: template.defaultRamMb,
          ports: template.ports,
        }
      : null,
    server: {
      id: server.id,
      name: server.name,
      status: server.status,
      ramMb: server.ramMb,
      cpuLimit: server.cpuLimit,
      diskLimitMb: server.diskLimitMb,
      createdAt: server.createdAt,
      lastStartedAt: server.lastStartedAt,
      env: sanitizedServerEnv,
    },
  };

  // 6. Host specs
  const hostData = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    totalHostRamMb: host.totalHostRamMb,
    budgetRamMb: host.budgetRamMb,
    availableBudgetRamMb: host.availableBudgetRamMb,
    cpus: os.cpus().length,
    uptimeSeconds: Math.round(os.uptime()),
  };

  const files: ZipFileEntry[] = [
    { name: 'logs.txt', data: Buffer.from(logsText, 'utf-8') },
    { name: 'inspect.json', data: Buffer.from(JSON.stringify(inspectData, null, 2), 'utf-8') },
    { name: 'events.json', data: Buffer.from(JSON.stringify(serverEvents, null, 2), 'utf-8') },
    { name: 'stats.json', data: Buffer.from(JSON.stringify(statsData, null, 2), 'utf-8') },
    { name: 'configuration.json', data: Buffer.from(JSON.stringify(templateData, null, 2), 'utf-8') },
    { name: 'host.json', data: Buffer.from(JSON.stringify(hostData, null, 2), 'utf-8') },
  ];

  return createZipArchive(files);
}
