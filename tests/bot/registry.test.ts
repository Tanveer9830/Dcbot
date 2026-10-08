import { describe, expect, it } from 'vitest';
import { OwnerOnlyError, OwnerPolicy, PERMISSION_BIT, ValidationError } from '@dcbot/shared';
import { CommandRegistry } from '../../apps/bot/src/commands/registry.js';
import { CooldownManager } from '../../apps/bot/src/utils/cooldown.js';
import type { SlashCommand } from '../../apps/bot/src/types.js';

const OWNER = '1131248987173814336';
const STRANGER = '123456789012345678';

function command(name: string, overrides: Partial<SlashCommand> = {}): SlashCommand {
  return {
    data: { toJSON: () => ({ name, description: `${name} command` }) },
    description: `${name} command`,
    execute: async () => undefined,
    ...overrides,
  } as SlashCommand;
}

const owners = new OwnerPolicy({ raw: OWNER });

function authorize(
  registry: CommandRegistry,
  cmd: SlashCommand,
  overrides: Record<string, unknown> = {},
) {
  return registry.authorize({
    command: cmd,
    userId: STRANGER,
    memberPermissions: 0n,
    clientPermissions: PERMISSION_BIT.SEND_MESSAGES,
    memberRoleIds: [],
    staffRoleIds: [],
    trustedUserIds: [],
    owners,
    ...overrides,
  } as never);
}

describe('CommandRegistry', () => {
  it('registers commands and refuses duplicate names', () => {
    const registry = new CommandRegistry(new CooldownManager());
    registry.register(command('ping'));
    expect(registry.has('ping')).toBe(true);
    expect(registry.size).toBe(1);
    expect(() => registry.register(command('ping'))).toThrow(ValidationError);
  });

  it('allows owner-only commands only for configured owners', () => {
    const registry = new CommandRegistry(new CooldownManager());
    const cmd = command('globalcommand', { ownerOnly: true });

    expect(authorize(registry, cmd, { userId: OWNER })).toBeNull();
    const denied = authorize(registry, cmd);
    expect(denied).toBeInstanceOf(OwnerOnlyError);
  });

  it('never lets a guild Administrator reach an owner-only command', () => {
    const registry = new CommandRegistry(new CooldownManager());
    const cmd = command('branding', { ownerOnly: true });
    const denied = authorize(registry, cmd, { memberPermissions: PERMISSION_BIT.ADMINISTRATOR });
    expect(denied).toBeInstanceOf(OwnerOnlyError);
  });

  it('checks the bot permissions before the member permissions', () => {
    const registry = new CommandRegistry(new CooldownManager());
    const cmd = command('ban', {
      userPermissions: [PERMISSION_BIT.BAN_MEMBERS],
      clientPermissions: [PERMISSION_BIT.BAN_MEMBERS],
    });

    const missing = authorize(registry, cmd, {
      clientPermissions: 0n,
      memberPermissions: PERMISSION_BIT.BAN_MEMBERS,
    });
    expect(missing?.message).toMatch(/bot is missing/);

    const userMissing = authorize(registry, cmd, {
      memberPermissions: 0n,
      clientPermissions: PERMISSION_BIT.BAN_MEMBERS,
    });
    expect(userMissing?.message).toMatch(/You need/);

    const ok = authorize(registry, cmd, {
      memberPermissions: PERMISSION_BIT.BAN_MEMBERS,
      clientPermissions: PERMISSION_BIT.BAN_MEMBERS,
    });
    expect(ok).toBeNull();
  });

  it('treats server staff as administrators, staff roles, or trusted users', () => {
    const registry = new CommandRegistry(new CooldownManager());
    const cmd = command('purge', { staffOnly: true });

    expect(authorize(registry, cmd)).not.toBeNull();
    expect(authorize(registry, cmd, { memberPermissions: PERMISSION_BIT.MANAGE_GUILD })).toBeNull();
    expect(authorize(registry, cmd, { memberPermissions: PERMISSION_BIT.BAN_MEMBERS })).toBeNull();
    expect(authorize(registry, cmd, { memberRoleIds: ['111'], staffRoleIds: ['111'] })).toBeNull();
    expect(authorize(registry, cmd, { trustedUserIds: [STRANGER] })).toBeNull();
    expect(authorize(registry, cmd, { trustedUserIds: ['someone-else'] })).not.toBeNull();
  });

  it('names the missing permissions in human terms', () => {
    const registry = new CommandRegistry(new CooldownManager());
    const cmd = command('lock', { clientPermissions: [PERMISSION_BIT.MANAGE_CHANNELS] });
    expect(authorize(registry, cmd, { clientPermissions: 0n })?.message).toContain(
      'Manage Channels',
    );
  });

  it('applies the cooldown only after the first successful run', () => {
    let clock = 0;
    const registry = new CommandRegistry(new CooldownManager(() => clock));
    const cmd = command('dice', { cooldownMs: 5_000 });

    expect(registry.applyCooldown(cmd, STRANGER, '1')).toBe(0);
    const blocked = registry.applyCooldown(cmd, STRANGER, '1');
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThanOrEqual(5_000);

    // A different user is unaffected.
    expect(registry.applyCooldown(cmd, '999999999999999999', '1')).toBe(0);

    clock = 6_000;
    expect(registry.applyCooldown(cmd, STRANGER, '1')).toBe(0);
  });

  it('validates command metadata before anything is sent to Discord', () => {
    const registry = new CommandRegistry(new CooldownManager());
    registry.register(command('ping'));
    expect(registry.validate().valid).toBe(true);

    const bad = new CommandRegistry(new CooldownManager());
    bad.register(command('a'.repeat(40))); // over Discord's 32-character name limit
    bad.register({ ...command('nodesc'), description: '' } as SlashCommand);
    const result = bad.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/32 characters/);
  });

  it('flags a command set that exceeds the Discord top-level limit', () => {
    const registry = new CommandRegistry(new CooldownManager());
    registry.registerAll(Array.from({ length: 101 }, (_, index) => command(`cmd${index}`)));
    const result = registry.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/exceeds Discord's limit of 100/);
  });

  it('warns when a command is marked both ownerOnly and staffOnly', () => {
    const registry = new CommandRegistry(new CooldownManager());
    registry.register(command('weird', { ownerOnly: true, staffOnly: true }));
    expect(registry.validate().warnings.join(' ')).toMatch(/ownerOnly wins/);
  });
});
