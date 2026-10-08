import { env } from './env';

/**
 * Client for the bot's internal metrics API.
 *
 * Every value the owner panel shows for "live bot state" comes from here. When
 * the API is not configured or not reachable, this returns `available: false`
 * with a reason and the UI says *unavailable* - it never guesses a number.
 */

export interface BotMetrics {
  generatedAt: string;
  process: {
    pid: number;
    node: string;
    uptimeMs: number;
    memory: { rss: string; heapUsed: string; heapTotal: string };
    cpu: { load1: number; cores: number };
  };
  gateway: { status: string; pingMs: number | null; guilds: number; cachedUsers: number };
  services: Array<{
    service: string;
    status: string;
    latencyMs?: number | null;
    detail?: string | null;
  }>;
  commands: { total: number; ownerOnly: number; staffOnly: number } | null;
  logs: { debug: number; info: number; warn: number; error: number };
  security: { last24h: number; criticalLast24h: number } | null;
}

export type BotMetricsResult =
  { available: true; metrics: BotMetrics } | { available: false; reason: string };

function baseUrl(): string | null {
  const config = env();
  if (!config.BOT_API_ENABLED) return null;
  if (config.BOT_API_URL) return config.BOT_API_URL.replace(/\/$/, '');
  return `http://${config.BOT_API_HOST}:${config.BOT_API_PORT}`;
}

/** Fetches the metrics snapshot. Never throws: failures become a reason string. */
export async function fetchBotMetrics(timeoutMs = 3000): Promise<BotMetricsResult> {
  const base = baseUrl();
  if (!base) {
    return { available: false, reason: 'BOT_API_ENABLED is off on the dashboard' };
  }
  const token = env().BOT_API_TOKEN;
  if (!token) {
    return { available: false, reason: 'BOT_API_TOKEN is not set on the dashboard' };
  }

  try {
    const response = await fetch(`${base}/metrics`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!response.ok) {
      return { available: false, reason: `bot API responded ${response.status}` };
    }
    return { available: true, metrics: (await response.json()) as BotMetrics };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : 'bot API unreachable',
    };
  }
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}
