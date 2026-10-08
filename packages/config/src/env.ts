import { z } from 'zod';
import { ConfigurationError, maskId, parseIdList } from '@dcbot/shared';

/**
 * Centralized environment configuration.
 *
 * One canonical name is used for the Discord bot token everywhere in this
 * project: DISCORD_TOKEN. There is no BOT_TOKEN alias.
 *
 * `loadEnv` never throws for optional subsystems; it throws a single aggregated
 * ConfigurationError listing every missing REQUIRED variable so operators get
 * one actionable message instead of a cascade.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  })
  .default(false);

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ALLOW_NO_DATABASE: booleanish,

  DISCORD_TOKEN: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,
  DISCORD_REDIRECT_URI: optionalString,
  DISCORD_DEV_GUILD_ID: optionalString,
  BOT_OWNER_IDS: z.string().optional().default(''),
  DASHBOARD_URL: optionalString,
  SESSION_SECRET: optionalString,

  DATABASE_URL: optionalString,
  DATABASE_SSL: booleanish,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  MIGRATIONS_DIR: z.string().default('./database/migrations'),

  REDIS_URL: optionalString,

  LAVALINK_HOST: optionalString,
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65535).default(2333),
  LAVALINK_PASSWORD: optionalString,
  LAVALINK_SECURE: booleanish,
  SPOTIFY_CLIENT_ID: optionalString,
  SPOTIFY_CLIENT_SECRET: optionalString,
  MUSIC_ENABLED: booleanish,

  BOT_API_ENABLED: booleanish,
  /** Bind address for the metrics API. Loopback by default; set to 0.0.0.0
   *  only when another container/host must reach it, and always with a token. */
  BOT_API_HOST: z.string().default('127.0.0.1'),
  BOT_API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** Absolute URL the dashboard uses to reach the bot metrics API. Defaults to
   *  http://BOT_API_HOST:BOT_API_PORT, which only works on a single host. */
  BOT_API_URL: optionalString,
  BOT_API_TOKEN: optionalString,
});

export type Env = z.infer<typeof envSchema> & {
  ownerIds: string[];
  isProduction: boolean;
};

export interface LoadEnvOptions {
  /** Environment source. Defaults to process.env. */
  source?: NodeJS.ProcessEnv;
  /** 'bot' requires DISCORD_TOKEN; 'dashboard' requires OAuth + session vars. */
  require?: Array<'bot' | 'dashboard' | 'database'>;
  /** Fail on missing required values (default true). */
  throwOnError?: boolean;
}

export interface LoadEnvResult {
  env: Env;
  missing: string[];
  warnings: string[];
}

function collectMissing(env: Env, requires: LoadEnvOptions['require']): string[] {
  const missing: string[] = [];
  const needs = requires ?? [];
  if (needs.includes('bot')) {
    if (!env.DISCORD_TOKEN) missing.push('DISCORD_TOKEN');
    if (!env.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
    if (env.ownerIds.length === 0) missing.push('BOT_OWNER_IDS');
  }
  if (needs.includes('dashboard')) {
    if (!env.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
    if (!env.DISCORD_CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
    if (!env.DISCORD_REDIRECT_URI) missing.push('DISCORD_REDIRECT_URI');
    if (!env.SESSION_SECRET) missing.push('SESSION_SECRET');
    if (!env.DASHBOARD_URL) missing.push('DASHBOARD_URL');
    if ((env.SESSION_SECRET?.length ?? 0) < 32) {
      missing.push('SESSION_SECRET (must be at least 32 characters)');
    }
  }
  if (needs.includes('database')) {
    if (!env.DATABASE_URL && !env.ALLOW_NO_DATABASE) missing.push('DATABASE_URL');
  }
  return missing;
}

function collectWarnings(env: Env): string[] {
  const warnings: string[] = [];
  if (env.isProduction && env.ALLOW_NO_DATABASE) {
    warnings.push('ALLOW_NO_DATABASE is set in production - the bot will run without persistence.');
  }
  if (env.isProduction && env.DISCORD_DEV_GUILD_ID) {
    warnings.push('DISCORD_DEV_GUILD_ID is set in production - commands register to one guild only.');
  }
  if (env.MUSIC_ENABLED && !env.LAVALINK_HOST) {
    warnings.push('MUSIC_ENABLED=true but LAVALINK_HOST is empty - music commands will fail at runtime.');
  }
  if (env.MUSIC_ENABLED && (env.SPOTIFY_CLIENT_ID || env.SPOTIFY_CLIENT_SECRET)) {
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
      warnings.push('Provide both SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET or neither.');
    }
  }
  if (!env.BOT_OWNER_IDS) {
    warnings.push('BOT_OWNER_IDS is empty - no owner-only commands will be usable.');
  }
  return warnings;
}

/**
 * Parses and validates the environment. Throws ConfigurationError listing every
 * problem at once. Secret values are never included in the message.
 */
export function loadEnv(options: LoadEnvOptions = {}): Env {
  const { source = process.env, require, throwOnError = true } = options;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigurationError(`Environment variables failed validation: ${issues}`);
  }
  const base = parsed.data;
  const { ids, invalid } = parseIdList(base.BOT_OWNER_IDS);
  if (invalid.length > 0) {
    throw new ConfigurationError(
      `BOT_OWNER_IDS contains invalid entries (${invalid.map(maskId).join(', ')}). ` +
        'Each owner must be a numeric Discord snowflake.',
    );
  }
  const env: Env = {
    ...base,
    ownerIds: ids,
    isProduction: base.NODE_ENV === 'production',
  };

  const missing = collectMissing(env, require);
  if (missing.length > 0 && throwOnError) {
    throw new ConfigurationError(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'See .env.example for the expected shape.',
    );
  }
  return env;
}

/** Non-throwing variant used by health endpoints and tests. */
export function inspectEnv(source: NodeJS.ProcessEnv = process.env): LoadEnvResult {
  {
    const env = loadEnv({ source, require: ['bot', 'dashboard', 'database'], throwOnError: false });
    return {
      env,
      missing: collectMissing(env, ['bot', 'dashboard', 'database']),
      warnings: collectWarnings(env),
    };
  }
}

/** Masks a connection string for safe logging. */
export function redactConnectionString(url: string | undefined): string {
  if (!url) return '(unset)';
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}
