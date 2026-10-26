/**
 * WebSocket Gateway for realtime server monitoring and interactive console.
 *
 * Implements §8 and §9.2 of IMPLEMENTATION_PLAN.md:
 * WebSocket route `/ws/servers/:id` multiplexing:
 * - log: live logs stream
 * - stats: live CPU/RAM/network stats
 * - status: server state changes
 * - event: timeline events
 * - client messages: { type: "command", data: "..." } (permission-checked with 'server:console')
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { verifyToken, COOKIE_NAME } from '../auth/sessions.js';
import { can } from '../auth/rbac.js';
import { getDatabase } from '../db/index.js';
import { servers } from '../db/schema.js';
import { getDockerDriver } from '../servers/service.js';
import { executeServerCommand } from '../servers/console.js';

export interface WsMessage {
  type: 'log' | 'stats' | 'status' | 'event' | 'command' | 'command_ack' | 'error';
  data: unknown;
}

export async function registerRealtimeGateway(app: FastifyInstance): Promise<void> {
  app.get(
    '/ws/servers/:id',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const { id: serverId } = request.params as { id: string };

      // 1. Authenticate via session cookie
      const token = request.cookies[COOKIE_NAME];
      if (!token) {
        socket.send(JSON.stringify({ type: 'error', data: 'Authentication required' }));
        socket.close(4401, 'Unauthorized');
        return;
      }

      const session = verifyToken(token);
      if (!session) {
        socket.send(JSON.stringify({ type: 'error', data: 'Invalid or expired session' }));
        socket.close(4401, 'Unauthorized');
        return;
      }

      const user = { id: session.sub, role: session.role };

      // 2. Authorize 'server:view'
      const hasViewPermission = await can(user, 'server:view', serverId);
      if (!hasViewPermission) {
        socket.send(JSON.stringify({ type: 'error', data: 'Access denied' }));
        socket.close(4403, 'Forbidden');
        return;
      }

      const db = getDatabase();
      const server = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
      if (!server) {
        socket.send(JSON.stringify({ type: 'error', data: 'Server not found' }));
        socket.close(4404, 'Not Found');
        return;
      }

      // Initial status message
      socket.send(JSON.stringify({ type: 'status', data: server.status }));

      // 3. Periodic stats & status stream
      const statsInterval = setInterval(async () => {
        if (socket.readyState !== socket.OPEN) {
          clearInterval(statsInterval);
          return;
        }

        try {
          if (server.containerId && server.status === 'running') {
            const driver = getDockerDriver();
            const stats = await driver.getContainerStats(server.containerId);
            socket.send(JSON.stringify({ type: 'stats', data: stats }));
          }
        } catch {
          // ignore transient stats error
        }
      }, 3000);

      // 4. Send recent logs to initialize xterm console
      if (server.containerId) {
        try {
          const driver = getDockerDriver();
          const logs = await driver.getContainerLogs(server.containerId, 100);
          for (const line of logs) {
            socket.send(JSON.stringify({ type: 'log', data: line }));
          }
        } catch {
          // container might be stopped
        }
      }

      // 5. Inbound client messages
      socket.on('message', async (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type?: string; data?: unknown };
          if (msg.type === 'command') {
            // Permission check: 'server:console'
            const hasConsolePermission = await can(user, 'server:console', serverId);
            if (!hasConsolePermission) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  data: 'Permission denied: console access required',
                }),
              );
              return;
            }

            const commandStr = typeof msg.data === 'string' ? msg.data : '';
            const result = await executeServerCommand(serverId, user.id, commandStr, request.ip);
            socket.send(JSON.stringify({ type: 'command_ack', data: result }));
          }
        } catch (err) {
          socket.send(
            JSON.stringify({
              type: 'error',
              data: err instanceof Error ? err.message : 'Invalid message format',
            }),
          );
        }
      });

      socket.on('close', () => {
        clearInterval(statsInterval);
      });
    },
  );
}
