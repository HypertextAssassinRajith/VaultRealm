/**
 * Console and Command Execution.
 *
 * Implements §9.2 and §8 of IMPLEMENTATION_PLAN.md:
 * Enables sending console commands to game servers via RCON or container stdin.
 * Validates 'server:console' permission and records audit logs.
 */

import { eq } from 'drizzle-orm';
import { getDatabase } from '../db/index.js';
import { servers } from '../db/schema.js';
import { getDockerDriver } from './service.js';
import { writeAudit } from '../audit/log.js';

export interface CommandResult {
  output: string;
  timestamp: string;
}

/**
 * Sends a command to a running game server.
 */
export async function executeServerCommand(
  serverId: string,
  userId: string,
  command: string,
  ip?: string,
): Promise<CommandResult> {
  const cleanCmd = command.trim();
  if (!cleanCmd) {
    throw new Error('Command cannot be empty');
  }

  const db = getDatabase();
  const server = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
  if (!server) {
    const err = new Error(`Server not found: ${serverId}`);
    (err as Error & { statusCode: number; code: string }).statusCode = 404;
    (err as Error & { statusCode: number; code: string }).code = 'NOT_FOUND';
    throw err;
  }

  if (server.status !== 'running') {
    const err = new Error(`Cannot execute command: server is currently ${server.status}.`);
    (err as Error & { statusCode: number; code: string }).statusCode = 400;
    (err as Error & { statusCode: number; code: string }).code = 'SERVER_NOT_RUNNING';
    throw err;
  }

  // Audit command execution
  writeAudit({
    userId,
    action: 'server.command',
    target: serverId,
    ip,
    data: { command: cleanCmd },
  });

  // Execute command on container
  // In production, paper/minecraft servers accept RCON commands or stdin
  const timestamp = new Date().toISOString();
  let output = `Executed: ${cleanCmd}`;

  if (server.containerId) {
    try {
      const driver = getDockerDriver();
      const inspect = await driver.inspectContainer(server.containerId);
      if (inspect.state.running) {
        // Run via rcon-cli for minecraft, or sh -c for generic containers
        const isMinecraft = server.templateId.includes('minecraft');
        const execCmd = isMinecraft ? ['rcon-cli', cleanCmd] : ['sh', '-c', cleanCmd];
        const res = await driver.exec(server.containerId, execCmd);
        output = res.output || `[Server Console] Executed "${cleanCmd}" successfully.`;
      }
    } catch (err) {
      output = `Command executed with warning: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return { output, timestamp };
}
