import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadCommands } from '../../apps/bot/src/commands/loader.js';
import { CommandRegistry, commandName } from '../../apps/bot/src/commands/registry.js';
import { CooldownManager } from '../../apps/bot/src/utils/cooldown.js';
import { Logger } from '../../apps/bot/src/utils/logger.js';
import type { SlashCommand } from '../../apps/bot/src/types.js';

let commands: SlashCommand[] = [];
let registry: CommandRegistry;

beforeAll(async () => {
  const loaded = await loadCommands(path.resolve('apps/bot/src/commands'), new Logger({ level: 'error' }));
  expect(loaded.skipped, `skipped files: ${loaded.skipped.join(', ')}`).toEqual([]);
  commands = loaded.commands;
  registry = new CommandRegistry(new CooldownManager());
  registry.registerAll(commands);
}, 60_000);

describe('command catalog', () => {
  it('discovers a substantial catalog with no duplicate names', () => {
    const names = commands.map(commandName);
    expect(names.length).toBeGreaterThan(50);
    expect(new Set(names).size).toBe(names.length);
    expect(registry.size).toBe(names.length);
  });

  it('satisfies every documented Discord limit', () => {
    const result = registry.validate();
    expect(result.errors).toEqual([]);
  });

  it('serialises a payload whose shape matches the registered commands', () => {
    const payload = registry.toJSON();
    expect(payload).toHaveLength(registry.size);
    for (const entry of payload) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.description).toBe('string');
    }
  });

  it('restricts exactly the documented owner-only commands', () => {
    const ownerOnly = commands.filter((command) => command.ownerOnly).map(commandName).sort();
    expect(ownerOnly).toEqual(['branding', 'globalcommand', 'guilds', 'health']);
  });

  it('keeps owner-only and staff-only mutually exclusive', () => {
    const both = commands.filter((command) => command.ownerOnly && command.staffOnly).map(commandName);
    expect(both).toEqual([]);
  });

  it('marks destructive moderation commands as staff-only', () => {
    for (const name of ['ban', 'kick', 'timeout', 'purge', 'warn', 'lock']) {
      const command = registry.get(name);
      expect(command, `${name} should exist`).toBeDefined();
      expect(command?.staffOnly, `${name} must be staff-only`).toBe(true);
    }
  });

  it('gives every command a description and an execute handler', () => {
    for (const command of commands) {
      const name = commandName(command);
      expect(command.description, `${name} needs a description`).toBeTruthy();
      expect(typeof command.execute, `${name} needs execute`).toBe('function');
    }
  });
});
