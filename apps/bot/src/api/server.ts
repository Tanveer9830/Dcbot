import { createServer, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Client } from 'discord.js';
import type { Repositories } from '../database/repositories.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { HealthService } from '../services/health.js';
import type { Logger } from '../utils/logger.js';
import { logStats } from '../utils/logger.js';

export interface BotApiOptions {
  host: string;
  port: number;
  token: string;
  client: Client;
  health: HealthService;
  repos: Repositories | null;
  registry: CommandRegistry | null;
  startedAt: number;
  logger: Logger;
}

export interface BotApiHandle {
  host: string;
  port: number;
  close(): Promise<void>;
}

/**
 * Internal metrics API used by the dashboard's owner panel.
 *
 * Rules:
 *  - every endpoint except `GET /healthz` requires `Authorization: Bearer <token>`,
 *    compared in constant time,
 *  - the server refuses to start without a token, because an unauthenticated
 *    metrics endpoint leaks guild counts and internal state,
 *  - every value returned is a measurement this process actually took. Nothing is
 *    estimated, cached from an earlier boot, or invented.
 */
export async function startBotApi(options: BotApiOptions): Promise<BotApiHandle> {
  const { host, port, token, client, health, repos, registry, startedAt, logger } = options;
  if (!token) {
    throw new Error('BOT_API_TOKEN is required when BOT_API_ENABLED=true.');
  }
  const expected = Buffer.from(`Bearer ${token}`);

  const authorized = (header: string | undefined): boolean => {
    if (!header) return false;
    const provided = Buffer.from(header);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  };

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    });
    res.end(payload);
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    void (async () => {
      try {
        if (req.method !== 'GET') {
          send(res, 405, { error: 'Only GET is supported.' });
          return;
        }

        if (url.pathname === '/healthz') {
          send(res, 200, { ok: true, uptimeMs: Date.now() - startedAt });
          return;
        }

        if (!authorized(req.headers.authorization)) {
          send(res, 401, { error: 'Missing or invalid bearer token.' });
          return;
        }

        if (url.pathname === '/health') {
          const snapshot = await health.snapshot({
            gatewayPingMs: client.ws.ping,
            wsStatus: client.ws.status === 0 ? 'ready' : String(client.ws.status),
            guildCount: client.guilds.cache.size,
            userCount: client.users.cache.size,
          });
          send(res, 200, snapshot);
          return;
        }

        if (url.pathname === '/metrics') {
          const snapshot = await health.snapshot({
            gatewayPingMs: client.ws.ping,
            wsStatus: client.ws.status === 0 ? 'ready' : String(client.ws.status),
            guildCount: client.guilds.cache.size,
            userCount: client.users.cache.size,
          });
          const commands = registry
            ? {
                total: registry.size,
                ownerOnly: registry.list().filter((command) => command.ownerOnly).length,
                staffOnly: registry.list().filter((command) => command.staffOnly).length,
              }
            : null;

          const security = repos
            ? await repos.security.countAllSince(new Date(Date.now() - 24 * 60 * 60 * 1000))
            : null;

          send(res, 200, {
            generatedAt: new Date().toISOString(),
            process: {
              pid: process.pid,
              node: process.version,
              uptimeMs: Date.now() - startedAt,
              memory: snapshot.memory,
              cpu: snapshot.cpu,
            },
            gateway: {
              status: snapshot.wsStatus,
              pingMs: snapshot.gatewayPingMs,
              guilds: snapshot.guildCount,
              cachedUsers: snapshot.userCount,
            },
            services: snapshot.services,
            commands,
            logs: logStats(),
            security: security && { last24h: security.total, criticalLast24h: security.critical },
          });
          return;
        }

        send(res, 404, { error: 'Not found. Try /healthz, /health or /metrics.' });
      } catch (error) {
        logger.error('bot api request failed', {
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error),
        });
        send(res, 500, { error: 'Internal error while collecting metrics.' });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  // Port 0 asks the OS for a free port, so report what was actually bound.
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  logger.info('metrics API listening', { host, port: boundPort });

  return {
    host,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
