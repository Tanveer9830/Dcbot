import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from 'discord.js';
import { startBotApi, type BotApiHandle } from '../../apps/bot/src/api/server.js';
import { HealthService } from '../../apps/bot/src/services/health.js';
import { Logger } from '../../apps/bot/src/utils/logger.js';

const TOKEN = 'test-metrics-token';

function fakeClient(): Client {
  return {
    ws: { ping: 42, status: 0 },
    guilds: { cache: { size: 3 } },
    users: { cache: { size: 25 } },
  } as unknown as Client;
}

const handles: BotApiHandle[] = [];

afterAll(async () => {
  await Promise.all(handles.map((handle) => handle.close()));
});

async function start(token: string): Promise<string> {
  const handle = await startBotApi({
    host: '127.0.0.1',
    port: 0,
    token,
    client: fakeClient(),
    health: new HealthService(null, null, Date.now() - 60_000),
    repos: null,
    registry: null,
    startedAt: Date.now() - 60_000,
    logger: new Logger({ level: 'error' }),
  });
  handles.push(handle);
  return `http://${handle.host}:${handle.port}`;
}

describe('bot metrics API', () => {
  it('refuses to start without a token', async () => {
    await expect(
      startBotApi({
        host: '127.0.0.1',
        port: 0,
        token: '',
        client: fakeClient(),
        health: new HealthService(null, null, Date.now()),
        repos: null,
        registry: null,
        startedAt: Date.now(),
        logger: new Logger({ level: 'error' }),
      }),
    ).rejects.toThrow(/BOT_API_TOKEN/);
  });

  it('exposes an unauthenticated liveness probe only', async () => {
    const base = await start(TOKEN);
    const alive = await fetch(`${base}/healthz`);
    expect(alive.status).toBe(200);
    expect(await alive.json()).toMatchObject({ ok: true });

    for (const path of ['/health', '/metrics']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, path).toBe(401);
    }
  });

  it('rejects a wrong bearer token', async () => {
    const base = await start(TOKEN);
    const response = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer nope' } });
    expect(response.status).toBe(401);
  });

  it('reports measured health values, never invented ones', async () => {
    const base = await start(TOKEN);
    const response = await fetch(`${base}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.gatewayPingMs).toBe(42);
    expect(body.guildCount).toBe(3);
    expect(body.uptimeMs).toBeGreaterThanOrEqual(50_000);
    // No database and no Lavalink are configured, so both must say so.
    const services = body.services as Array<Record<string, unknown>>;
    const database = services.find((service) => service.service === 'database');
    expect(database?.status).toBe('unknown');
    const lavalink = services.find((service) => service.service === 'lavalink');
    expect(lavalink?.status).toBe('unknown');
  });

  it('returns process, gateway, log and command metrics', async () => {
    const base = await start(TOKEN);
    const response = await fetch(`${base}/metrics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      process: { pid: number; node: string; memory: { rss: string } };
      gateway: { pingMs: number | null; guilds: number; cachedUsers: number };
      commands: unknown;
      security: unknown;
      logs: { error: number };
      generatedAt: string;
    };

    expect(body.process.pid).toBe(process.pid);
    expect(body.process.node).toBe(process.version);
    expect(typeof body.process.memory.rss).toBe('string');
    expect(body.gateway).toMatchObject({ pingMs: 42, guilds: 3, cachedUsers: 25 });
    expect(body.commands).toBeNull(); // no registry in this harness
    expect(body.security).toBeNull(); // no database in this harness
    expect(body.logs.error).toBeGreaterThanOrEqual(0);
    expect(typeof body.generatedAt).toBe('string');
  });

  it('answers 404 for unknown paths and 405 for writes', async () => {
    const base = await start(TOKEN);
    const missing = await fetch(`${base}/nope`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(missing.status).toBe(404);

    const posted = await fetch(`${base}/metrics`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(posted.status).toBe(405);
  });

  it('stops listening after close()', async () => {
    const handle = await startBotApi({
      host: '127.0.0.1',
      port: 0,
      token: TOKEN,
      client: fakeClient(),
      health: new HealthService(null, null, Date.now()),
      repos: null,
      registry: null,
      startedAt: Date.now(),
      logger: new Logger({ level: 'error' }),
    });
    const base = `http://${handle.host}:${handle.port}`;
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    await handle.close();
    await expect(fetch(`${base}/healthz`)).rejects.toThrow();
  });
});
