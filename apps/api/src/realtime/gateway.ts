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
import { getServerDiskUsage } from '../servers/volume.js';

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

      // 1. Authenticate via session cookie, Bearer header, or token query param
      let token = request.cookies[COOKIE_NAME];
      if (!token && request.headers.authorization?.startsWith('Bearer ')) {
        token = request.headers.authorization.slice(7).trim();
      }
      if (!token && typeof (request.query as Record<string, unknown>)?.token === 'string') {
        token = (request.query as Record<string, string>).token;
      }
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

      // Track how many logs we've already sent to avoid duplicates
      let lastLogCount = 0;

      // 3. Send initial logs + set up continuous log & stats streaming
      if (server.containerId) {
        try {
          const driver = getDockerDriver();
          const logs = await driver.getContainerLogs(server.containerId, 100);
          for (const line of logs) {
            socket.send(JSON.stringify({ type: 'log', data: line }));
          }
          lastLogCount = logs.length;
        } catch {
          // container might be stopped
        }
      }

      // 4. Periodic stats, status, and log streaming
      const streamInterval = setInterval(async () => {
        if (socket.readyState !== socket.OPEN) {
          clearInterval(streamInterval);
          return;
        }

        try {
          // Re-query server from DB to get latest status & containerId
          const currentServer = db.select().from(servers).where(eq(servers.id, serverId)).all()[0];
          if (!currentServer) {
            clearInterval(streamInterval);
            return;
          }

          // Send status updates when status changes
          if (currentServer.status !== server.status) {
            server.status = currentServer.status;
            socket.send(JSON.stringify({ type: 'status', data: currentServer.status }));
          }

          if (currentServer.containerId && currentServer.status === 'running') {
            const driver = getDockerDriver();

            // Stream new log lines since last check
            try {
              const allLogs = await driver.getContainerLogs(currentServer.containerId, 500);
              if (allLogs.length > lastLogCount) {
                const newLines = allLogs.slice(lastLogCount);
                for (const line of newLines) {
                  socket.send(JSON.stringify({ type: 'log', data: line }));
                }
                lastLogCount = allLogs.length;
              }
            } catch {
              // ignore transient log error
            }

            // Send resource stats (CPU, RAM, network, PIDs, and disk)
            try {
              const stats = await driver.getContainerStats(currentServer.containerId);
              const disk = getServerDiskUsage(currentServer.id, currentServer.diskLimitMb);
              socket.send(JSON.stringify({ type: 'stats', data: { ...stats, ...disk } }));
            } catch {
              // ignore transient stats error
            }
          }
        } catch {
          // ignore
        }
      }, 2000);

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
        clearInterval(streamInterval);
      });
    },
  );
}
