#!/usr/bin/env tsx
/**
 * Command smoke test (no Discord credentials required).
 *
 * Runs the real discovery + registration path used at boot and fails when a
 * file exports nothing or a definition violates Discord's documented limits.
 * Wired into CI and available as `npm run verify:commands`.
 */
import path from 'node:path';
import { loadCommands } from '../apps/bot/src/commands/loader.js';
import { CommandRegistry, commandName } from '../apps/bot/src/commands/registry.js';
import { CooldownManager } from '../apps/bot/src/utils/cooldown.js';
import { Logger } from '../apps/bot/src/utils/logger.js';

async function main(): Promise<number> {
  const logger = new Logger({ level: 'error' });
  const dir = path.resolve('apps/bot/src/commands');
  const loaded = await loadCommands(dir, logger);
  const registry = new CommandRegistry(new CooldownManager());
  registry.registerAll(loaded.commands);
  const validation = registry.validate();
  const payload = registry.toJSON();

  console.log(`files loaded  : ${loaded.files.length}`);
  console.log(
    `files skipped : ${loaded.skipped.length}${loaded.skipped.length ? ` (${loaded.skipped.join(', ')})` : ''}`,
  );
  console.log(`commands      : ${registry.size}`);
  console.log(
    `owner-only    : ${
      loaded.commands
        .filter((command) => command.ownerOnly)
        .map(commandName)
        .join(', ') || 'none'
    }`,
  );
  console.log(`staff-only    : ${loaded.commands.filter((command) => command.staffOnly).length}`);
  console.log(`limit errors  : ${validation.errors.length}`);
  for (const error of validation.errors) console.log(`  - ${error}`);
  for (const warning of validation.warnings) console.log(`  ! ${warning}`);
  console.log(
    `payload shape : ${payload.every((entry) => typeof entry.name === 'string' && typeof entry.description === 'string')}`,
  );
  console.log(
    `names         : ${payload
      .map((entry) => String(entry.name))
      .sort()
      .join(', ')}`,
  );

  const failed = loaded.skipped.length > 0 || !validation.valid || payload.length !== registry.size;
  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  return failed ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error('smoke test crashed:', error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  },
);
