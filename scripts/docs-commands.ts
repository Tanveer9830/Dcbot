#!/usr/bin/env tsx
/**
 * Generates the command reference in docs/COMMANDS.md from the *live* registry.
 *
 * The catalog is never written by hand: this reads the same command objects the
 * bot registers, so the documentation cannot drift from the code. Re-run with
 * `npm run docs:commands`.
 */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadCommands } from '../apps/bot/src/commands/loader.js';
import { CommandRegistry, commandName, formatPermissions } from '../apps/bot/src/commands/registry.js';
import { CooldownManager } from '../apps/bot/src/utils/cooldown.js';
import { Logger } from '../apps/bot/src/utils/logger.js';

interface OptionJson {
  name: string;
  description?: string;
  type: number;
  required?: boolean;
  options?: OptionJson[];
}

const OPTION_TYPES: Record<number, string> = {
  1: 'subcommand',
  2: 'subcommand group',
  3: 'text',
  4: 'integer',
  5: 'boolean',
  6: 'user',
  7: 'channel',
  8: 'role',
  9: 'mentionable',
  10: 'number',
  11: 'attachment',
};

function renderOptions(options: OptionJson[] | undefined, depth: number): string[] {
  if (!options || options.length === 0) return [];
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  for (const option of options) {
    const kind = OPTION_TYPES[option.type] ?? `type ${option.type}`;
    const required = option.required ? ' **(required)**' : '';
    lines.push(`${pad}- \`${option.name}\` (${kind})${required} — ${option.description ?? ''}`);
    lines.push(...renderOptions(option.options, depth + 1));
  }
  return lines;
}

async function main(): Promise<void> {
  const loaded = await loadCommands(path.resolve('apps/bot/src/commands'), new Logger({ level: 'error' }));
  const registry = new CommandRegistry(new CooldownManager());
  registry.registerAll(loaded.commands);
  const validation = registry.validate();
  if (!validation.valid) throw new Error(validation.errors.join('\n'));

  const commands = [...loaded.commands].sort((a, b) => commandName(a).localeCompare(commandName(b)));
  const ownerOnly = commands.filter((command) => command.ownerOnly);
  const staffOnly = commands.filter((command) => command.staffOnly && !command.ownerOnly);
  const publicCommands = commands.filter((command) => !command.ownerOnly && !command.staffOnly);

  const access = (command: (typeof commands)[number]): string => {
    if (command.ownerOnly) return 'Bot owner';
    const parts: string[] = [];
    if (command.staffOnly) parts.push('Server staff');
    if (command.userPermissions?.length) parts.push(formatPermissions(command.userPermissions));
    return parts.length > 0 ? parts.join(' + ') : 'Everyone';
  };

  const lines: string[] = [];
  lines.push('# Command reference');
  lines.push('');
  lines.push(
    `Generated from the live registry by \`npm run docs:commands\` — **do not edit by hand**. ` +
      `${commands.length} top-level commands are registered, inside Discord's limit of 100 per scope.`,
  );
  lines.push('');
  lines.push('## Access levels');
  lines.push('');
  lines.push('| Level | Who | How it is decided |');
  lines.push('| --- | --- | --- |');
  lines.push(
    '| Bot owner | The IDs in `BOT_OWNER_IDS` | `OwnerPolicy` — a guild Administrator is **never** a bot owner |',
  );
  lines.push(
    '| Server staff | Manage Server, Ban Members, a configured staff role, or a trusted user | `isGuildStaff` |',
  );
  lines.push('| Everyone | Any member who can see the channel | Discord permissions only |');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Command | Description | Access | Cooldown |`);
  lines.push('| --- | --- | --- | --- |');
  for (const command of commands) {
    const name = commandName(command);
    const description = command.description.replace(/\|/g, '\\|');
    const cooldown = command.cooldownMs ? `${Math.round(command.cooldownMs / 1000)}s` : 'default';
    lines.push(`| \`/${name}\` | ${description} | ${access(command)} | ${cooldown} |`);
  }
  lines.push('');
  lines.push(`## Owner-only commands (${ownerOnly.length})`);
  lines.push('');
  for (const command of ownerOnly) {
    lines.push(`- \`/${commandName(command)}\` — ${command.description}`);
  }
  lines.push('');
  lines.push(`## Staff-only commands (${staffOnly.length})`);
  lines.push('');
  for (const command of staffOnly) {
    lines.push(`- \`/${commandName(command)}\` — ${command.description}`);
  }
  lines.push('');
  lines.push(`## Open commands (${publicCommands.length})`);
  lines.push('');
  for (const command of publicCommands) {
    lines.push(`- \`/${commandName(command)}\` — ${command.description}`);
  }
  lines.push('');
  lines.push('## Options');
  lines.push('');
  for (const command of commands) {
    const json = command.data.toJSON() as unknown as { options?: OptionJson[] };
    const rendered = renderOptions(json.options, 0);
    lines.push(`### \`/${commandName(command)}\``);
    lines.push('');
    lines.push(command.description);
    lines.push('');
    if (command.guildOnly) lines.push('Server-only.');
    if (command.requiresDatabase) lines.push('Requires the database.');
    if (command.clientPermissions?.length) {
      lines.push(`Bot needs: ${formatPermissions(command.clientPermissions)}.`);
    }
    lines.push('');
    if (rendered.length === 0) lines.push('_No options._');
    else lines.push(...rendered);
    lines.push('');
  }

  const header = lines.join('\n');
  await writeFile(path.resolve('docs/COMMANDS.md'), `${header}\n`, 'utf8');
  console.log(`docs/COMMANDS.md written: ${commands.length} commands`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
