import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@dcbot/config';
import { Database, closeDatabase } from '@dcbot/database';
import { OwnerPolicy } from '@dcbot/shared';
import { DcbotClient } from './client.js';
import { Repositories } from './database/repositories.js';
import { loadCommands } from './commands/loader.js';
import { CommandRegistry } from './commands/registry.js';
import { ServiceRegistry } from './services/registry.js';
import { CooldownManager } from './utils/cooldown.js';
import { Logger } from './utils/logger.js';
import { registerEvents } from './events/index.js';
import { registerInteractionHandler } from './events/interactions.js';
import { registerGuildEvents } from './events/guild.js';
import { ModerationService } from './services/moderation.js';
import { SecurityService } from './services/security.js';
import { AutoModService } from './services/automod.js';
import { TicketService } from './services/tickets.js';
import { WelcomeService } from './services/welcome.js';
import { EconomyService } from './services/economy.js';
import { LevelingService } from './services/leveling.js';
import { GiveawayService } from './services/giveaways.js';
import { LoggingService } from './services/logging.js';
import { BrandingService } from './services/branding.js';
import { CustomCommandService } from './services/customCommands.js';
import { HealthService } from './services/health.js';
import { NoTagService } from './security/noTag.js';
import { NoPinService } from './security/noPin.js';
import { LockdownManager } from './security/lockdown.js';
import { MusicManager } from './music/manager.js';
import { DiscordVoiceBridge } from './music/voiceBridge.js';
import { startBackgroundJobs, type JobHandle } from './automation/scheduler.js';
import type { BotContext } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Process bootstrap.
 *
 * Fails fast and loudly on bad configuration, degrades gracefully on optional
 * subsystems, and shuts down cleanly on SIGINT/SIGTERM.
 */
async function main(): Promise<void> {
  const logger = new Logger();
  const startedAt = Date.now();

  let env;
  try {
    env = loadEnv({ require: ['bot', 'database'], throwOnError: false });
  } catch (error) {
    logger.error('environment validation failed', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }

  const missing: string[] = [];
  if (!env.DISCORD_TOKEN) missing.push('DISCORD_TOKEN');
  if (!env.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
  if (env.ownerIds.length === 0) missing.push('BOT_OWNER_IDS');
  if (missing.length > 0) {
    logger.error('refusing to start: missing required configuration', { missing });
    process.exit(1);
  }
  if (!env.DISCORD_TOKEN) {
    logger.error('refusing to start: DISCORD_TOKEN is empty');
    process.exit(1);
  }

  // Owner policy is validated at startup; bad owner IDs abort the boot.
  let owners: OwnerPolicy;
  try {
    owners = new OwnerPolicy({ raw: env.BOT_OWNER_IDS, strict: true });
  } catch (error) {
    logger.error('invalid BOT_OWNER_IDS', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
  logger.info('owner policy loaded', { owners: owners.count, masked: owners.listMasked().join(', ') });

  // Database: required unless explicitly opted out (and never in production).
  let db: Database | null = null;
  if (env.DATABASE_URL) {
    db = new Database({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL,
      max: env.DATABASE_POOL_MAX,
      applicationName: 'dcbot-bot',
    });
    const ping = await db.ping();
    if (!ping.ok) {
      if (env.isProduction) {
        logger.error('database unreachable in production - aborting', { detail: ping.error });
        process.exit(1);
      }
      logger.warn('database unreachable; continuing without persistence', { detail: ping.error });
      await db.close();
      db = null;
    } else {
      logger.info('database connected', { latencyMs: ping.latencyMs });
    }
  } else if (env.isProduction) {
    logger.error('DATABASE_URL is required in production');
    process.exit(1);
  } else {
    logger.warn('DATABASE_URL not set; running without persistence');
  }

  const repos = db ? new Repositories(db, owners) : null;
  const services = new ServiceRegistry();
  const cooldowns = new CooldownManager();

  const context: BotContext & { client?: DcbotClient; cooldowns?: CooldownManager } = {
    env,
    owners,
    logger,
    db,
    repos,
    services,
    cooldowns,
    startedAt,
  };

  const client = new DcbotClient(context);
  context.client = client;

  // --- services ---------------------------------------------------------------
  if (repos && db) {
    const logging = new LoggingService(repos, logger);
    services.logging = logging;
    services.moderation = new ModerationService(repos, logging, logger);
    services.automod = new AutoModService(repos, logger);
    services.tickets = new TicketService(repos, logger);
    services.welcome = new WelcomeService(repos, logger);
    services.economy = new EconomyService(repos);
    services.leveling = new LevelingService(repos);
    services.giveaways = new GiveawayService(repos, logger);
    services.branding = new BrandingService(repos, owners);
    services.customCommands = new CustomCommandService(repos, owners);
    services.noTag = new NoTagService(repos.security);
    services.noPin = new NoPinService(repos.security);
    services.security = new SecurityService(
      repos.security,
      new LockdownManager(logger),
      logger,
      // Imported here to keep the constructor signature stable.
      new (await import('./utils/logger.js')).ThrottledLogger(logger, 60_000),
    );
  }

  if (env.MUSIC_ENABLED) {
    services.music = new MusicManager({
      host: env.LAVALINK_HOST,
      port: env.LAVALINK_PORT,
      password: env.LAVALINK_PASSWORD,
      secure: env.LAVALINK_SECURE,
      userId: env.DISCORD_CLIENT_ID ?? '0',
      spotifyClientId: env.SPOTIFY_CLIENT_ID,
      spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET,
      voice: new DiscordVoiceBridge(client),
      logger: logger.child({ scope: 'music' }),
    });
  }
  services.health = new HealthService(db, services.music ?? null, startedAt);

  // --- commands ---------------------------------------------------------------
  const registry = new CommandRegistry(cooldowns);
  const loaded = await loadCommands(path.join(here, 'commands'), logger);
  registry.registerAll(loaded.commands);
  context.registry = registry;

  const validation = registry.validate();
  for (const warning of validation.warnings) logger.warn(warning);
  if (!validation.valid) {
    logger.error('command validation failed - aborting', { errors: validation.errors });
    process.exit(1);
  }
  logger.info('commands loaded', {
    count: registry.size,
    files: loaded.files.length,
    skipped: loaded.skipped.length,
  });

  // --- events -----------------------------------------------------------------
  registerEvents(client, context);
  registerInteractionHandler(client, context, cooldowns);
  registerGuildEvents(client, context);

  let jobs: JobHandle | null = null;

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    jobs?.stop();
    try {
      await services.shutdown(context);
    } catch (error) {
      logger.warn('service shutdown error', { error: error instanceof Error ? error.message : String(error) });
    }
    client.destroy();
    await closeDatabase();
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { error: error.message, stack: error.stack });
  });

  await client.login(env.DISCORD_TOKEN);
  jobs = startBackgroundJobs(context);
  logger.info('bot started', { node: process.version, guilds: client.guilds.cache.size });
}

main().catch((error) => {
  console.error('[bootstrap] fatal:', error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
