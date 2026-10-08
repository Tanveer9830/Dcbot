#!/usr/bin/env tsx
/**
 * Slash command deployment.
 *
 * Commands are registered by this script, NOT on every bot startup: that keeps
 * the global command cache from being rewritten on each restart (global
 * propagation can take up to an hour).
 *
 *   npm run deploy-commands            # guild-scoped when DISCORD_DEV_GUILD_ID is set
 *   npm run deploy-commands -- --global
 */
import { REST, Routes } from 'discord.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@dcbot/config';
import { OwnerPolicy } from '@dcbot/shared';
import { loadCommands } from './commands/loader.js';
import { CommandRegistry } from './commands/registry.js';
import { CooldownManager } from './utils/cooldown.js';
import { Logger } from './utils/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const logger = new Logger();
  const env = loadEnv({ require: ['bot'] });
  new OwnerPolicy({ raw: env.BOT_OWNER_IDS, strict: true }); // Validates owner IDs before deploying.

  const { commands, skipped } = await loadCommands(path.join(here, 'commands'), logger);
  const registry = new CommandRegistry(new CooldownManager());
  registry.registerAll(commands);

  const validation = registry.validate();
  for (const warning of validation.warnings) logger.warn(warning);
  if (!validation.valid) {
    for (const error of validation.errors) logger.error(error);
    throw new Error('Command definitions failed validation; nothing was registered.');
  }

  const forceGlobal = process.argv.includes('--global');
  const payload = registry.toJSON();
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN!);

  if (env.DISCORD_DEV_GUILD_ID && !forceGlobal) {
    logger.info('registering guild commands', {
      guildId: env.DISCORD_DEV_GUILD_ID,
      count: payload.length,
    });
    await rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID!, env.DISCORD_DEV_GUILD_ID),
      {
        body: payload,
      },
    );
  } else {
    logger.info('registering global commands', { count: payload.length });
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID!), { body: payload });
  }

  logger.info('deployment complete', { commands: payload.length, skippedFiles: skipped.length });
  if (skipped.length > 0)
    logger.warn('files without a command export', { files: skipped.join(', ') });
}

main().catch((error) => {
  console.error('[deploy-commands] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
