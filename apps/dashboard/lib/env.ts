import { loadEnv } from '@dcbot/config';

/**
 * Dashboard configuration.
 *
 * Secrets are read only in server modules (lib/, route handlers, server
 * components). Nothing from this module is imported by a 'use client' file.
 */
let cached: ReturnType<typeof loadEnv> | null = null;

export function env(): ReturnType<typeof loadEnv> {
  if (!cached) {
    cached = loadEnv({ require: ['dashboard', 'database'], throwOnError: false });
  }
  return cached;
}

export interface ConfigProblem {
  missing: string[];
  warnings: string[];
}

export function configProblems(): ConfigProblem {
  const config = env();
  const missing: string[] = [];
  if (!config.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
  if (!config.DISCORD_CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
  if (!config.DISCORD_REDIRECT_URI) missing.push('DISCORD_REDIRECT_URI');
  if (!config.SESSION_SECRET || config.SESSION_SECRET.length < 32) {
    missing.push('SESSION_SECRET (min 32 characters)');
  }
  if (!config.DATABASE_URL) missing.push('DATABASE_URL');
  return { missing, warnings: [] };
}
