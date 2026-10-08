import os from 'node:os';
import type { Database } from '@dcbot/database';
import type { HealthSnapshot } from '@dcbot/shared';
import type { MusicManager } from '../music/manager.js';
import { formatBytes, formatDuration } from '../utils/format.js';

export interface BotHealth {
  status: 'ok' | 'degraded';
  uptimeMs: number;
  uptimeHuman: string;
  gatewayPingMs: number | null;
  wsStatus: string;
  guildCount: number;
  userCount: number;
  memory: { rss: string; heapUsed: string; heapTotal: string };
  cpu: { load1: number; cores: number };
  node: string;
  services: HealthSnapshot[];
}

/**
 * Health service.
 *
 * Reports only measurements it actually took. A subsystem that is not
 * configured is reported as `unknown` with an explanation rather than being
 * shown as healthy.
 */
export class HealthService {
  constructor(
    private readonly db: Database | null,
    private readonly music: MusicManager | null,
    private readonly startedAt: number,
  ) {}

  async snapshot(params: {
    gatewayPingMs: number | null;
    wsStatus: string;
    guildCount: number;
    userCount: number;
  }): Promise<BotHealth> {
    const memory = process.memoryUsage();
    const services: HealthSnapshot[] = [];

    if (this.db) {
      const ping = await this.db.ping();
      services.push({
        service: 'database',
        status: ping.ok ? 'ok' : 'down',
        latencyMs: ping.latencyMs,
        detail: ping.ok ? 'reachable' : (ping.error ?? 'unreachable'),
        checkedAt: new Date().toISOString(),
      });
    } else {
      services.push({
        service: 'database',
        status: 'unknown',
        detail: 'not configured (ALLOW_NO_DATABASE)',
        checkedAt: new Date().toISOString(),
      });
    }

    if (this.music) {
      const node = await this.music.health();
      services.push(node);
    } else {
      services.push({
        service: 'lavalink',
        status: 'unknown',
        detail: 'music subsystem disabled (MUSIC_ENABLED=false)',
        checkedAt: new Date().toISOString(),
      });
    }

    const uptimeMs = Date.now() - this.startedAt;
    const degraded = services.some((service) => service.status === 'down');
    return {
      status: degraded ? 'degraded' : 'ok',
      uptimeMs,
      uptimeHuman: formatDuration(uptimeMs),
      gatewayPingMs: params.gatewayPingMs,
      wsStatus: params.wsStatus,
      guildCount: params.guildCount,
      userCount: params.userCount,
      memory: {
        rss: formatBytes(memory.rss),
        heapUsed: formatBytes(memory.heapUsed),
        heapTotal: formatBytes(memory.heapTotal),
      },
      cpu: { load1: Number(os.loadavg()[0]?.toFixed(2) ?? 0), cores: os.cpus().length },
      node: process.version,
      services,
    };
  }
}
