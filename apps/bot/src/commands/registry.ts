import {
  AuthorizationError,
  COMMAND_NAME_REGEX,
  DISCORD_LIMITS,
  OwnerOnlyError,
  PERMISSION_BIT,
  ValidationError,
  hasAll,
  missingPermissions,
  type PermissionBit,
} from '@dcbot/shared';
import type { CooldownManager } from '../utils/cooldown.js';
import type { OwnerPolicy } from '@dcbot/shared';
import type { SlashCommand } from '../types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Command registry.
 *
 * Responsibilities:
 *  - hold the discovered command set,
 *  - validate names/limits *before* anything is sent to Discord,
 *  - enforce owner / staff / permission gates,
 *  - apply per-user cooldowns.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, SlashCommand>();

  constructor(private readonly cooldowns: CooldownManager) {}

  register(command: SlashCommand): void {
    const name = commandName(command);
    if (this.commands.has(name)) {
      throw new ValidationError(`Duplicate command name: ${name}`);
    }
    this.commands.set(name, command);
  }

  registerAll(commands: Iterable<SlashCommand>): void {
    for (const command of commands) this.register(command);
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  list(): SlashCommand[] {
    return [...this.commands.values()];
  }

  get size(): number {
    return this.commands.size;
  }

  /** JSON payloads for the Discord application command API. */
  toJSON(): Record<string, unknown>[] {
    return this.list().map((command) => command.data.toJSON() as Record<string, unknown>);
  }

  /**
   * Validates the whole set against Discord's documented limits. Called by the
   * deployment script and by tests so a bad command cannot reach the API.
   */
  validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const list = this.list();

    if (list.length > DISCORD_LIMITS.MAX_TOP_LEVEL_COMMANDS) {
      errors.push(
        `${list.length} top-level commands exceeds Discord's limit of ${DISCORD_LIMITS.MAX_TOP_LEVEL_COMMANDS}.`,
      );
    }

    for (const command of list) {
      const json = command.data.toJSON() as unknown as {
        name: string;
        description: string;
        options?: Array<Record<string, unknown>>;
      };
      if (!COMMAND_NAME_REGEX.test(json.name)) {
        errors.push(`"${json.name}": name must match ${COMMAND_NAME_REGEX}`);
      }
      if (json.name.length > DISCORD_LIMITS.MAX_COMMAND_NAME_LENGTH) {
        errors.push(`"${json.name}": name exceeds ${DISCORD_LIMITS.MAX_COMMAND_NAME_LENGTH} characters.`);
      }
      if (!json.description || json.description.length > DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH) {
        errors.push(`"${json.name}": description must be 1-${DISCORD_LIMITS.MAX_DESCRIPTION_LENGTH} characters.`);
      }
      const options = json.options ?? [];
      if (options.length > DISCORD_LIMITS.MAX_OPTIONS_PER_COMMAND) {
        errors.push(`"${json.name}": ${options.length} options exceeds the limit of ${DISCORD_LIMITS.MAX_OPTIONS_PER_COMMAND}.`);
      }
      const subcommandLike = options.filter((option) => option.type === 1 || option.type === 2);
      if (subcommandLike.length > DISCORD_LIMITS.MAX_SUBCOMMANDS_PER_COMMAND) {
        errors.push(
          `"${json.name}": ${subcommandLike.length} subcommands/groups exceeds the limit of ${DISCORD_LIMITS.MAX_SUBCOMMANDS_PER_COMMAND}.`,
        );
      }
      for (const option of options) {
        const nested = (option.options as Array<Record<string, unknown>> | undefined) ?? [];
        if (nested.length > DISCORD_LIMITS.MAX_SUBCOMMANDS_PER_GROUP) {
          errors.push(`"${json.name}.${String(option.name)}": ${nested.length} nested options exceeds the limit.`);
        }
      }
      if (command.ownerOnly && command.staffOnly) {
        warnings.push(`"${json.name}" is both ownerOnly and staffOnly; ownerOnly wins.`);
      }
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Authorization gate. Returns null when allowed, otherwise the error to show.
   * This is the single place where command access is decided.
   */
  authorize(params: {
    command: SlashCommand;
    userId: string;
    memberPermissions: bigint | null;
    clientPermissions: bigint | null;
    memberRoleIds: readonly string[];
    staffRoleIds: readonly string[];
    trustedUserIds: readonly string[];
    owners: OwnerPolicy;
  }): AuthorizationError | null {
    const { command } = params;
    if (command.ownerOnly) {
      try {
        params.owners.requireOwner(params.userId);
      } catch (error) {
        return error instanceof OwnerOnlyError ? error : new OwnerOnlyError();
      }
      return null;
    }

    const missingClient = missingPermissions(params.clientPermissions, command.clientPermissions ?? []);
    if (missingClient.length > 0) {
      return new AuthorizationError(`The bot is missing permission(s): ${formatPermissions(missingClient)}.`);
    }

    const missingUser = missingPermissions(params.memberPermissions, command.userPermissions ?? []);
    if (missingUser.length > 0) {
      return new AuthorizationError(`You need: ${formatPermissions(missingUser)}.`);
    }

    if (command.staffOnly) {
      const allowed =
        hasAll(params.memberPermissions, [PERMISSION_BIT.MANAGE_GUILD]) ||
        hasAll(params.memberPermissions, [PERMISSION_BIT.BAN_MEMBERS]) ||
        params.staffRoleIds.some((role) => params.memberRoleIds.includes(role));
      if (!allowed) {
        return new AuthorizationError('This command is restricted to server staff.');
      }
    }
    return null;
  }

  /** Applies the command cooldown. Returns retryAfterMs when blocked. */
  applyCooldown(command: SlashCommand, userId: string, guildId: string): number {
    const windowMs = command.cooldownMs ?? 3000;
    const result = this.cooldowns.check(`${commandName(command)}:${guildId}:${userId}`, 1, windowMs);
    return result.allowed ? 0 : result.retryAfterMs;
  }
}

export function commandName(command: SlashCommand): string {
  const json = command.data.toJSON() as unknown as { name: string };
  return json.name;
}

const PERMISSION_LABELS: ReadonlyMap<bigint, string> = new Map<bigint, string>([
  [PERMISSION_BIT.CREATE_INSTANT_INVITE, 'Create Instant Invite'],
  [PERMISSION_BIT.KICK_MEMBERS, 'Kick Members'],
  [PERMISSION_BIT.BAN_MEMBERS, 'Ban Members'],
  [PERMISSION_BIT.ADMINISTRATOR, 'Administrator'],
  [PERMISSION_BIT.MANAGE_CHANNELS, 'Manage Channels'],
  [PERMISSION_BIT.MANAGE_GUILD, 'Manage Server'],
  [PERMISSION_BIT.ADD_REACTIONS, 'Add Reactions'],
  [PERMISSION_BIT.VIEW_AUDIT_LOG, 'View Audit Log'],
  [PERMISSION_BIT.VIEW_CHANNEL, 'View Channel'],
  [PERMISSION_BIT.SEND_MESSAGES, 'Send Messages'],
  [PERMISSION_BIT.SEND_MESSAGES_IN_THREADS, 'Send Messages In Threads'],
  [PERMISSION_BIT.MANAGE_MESSAGES, 'Manage Messages'],
  [PERMISSION_BIT.EMBED_LINKS, 'Embed Links'],
  [PERMISSION_BIT.ATTACH_FILES, 'Attach Files'],
  [PERMISSION_BIT.READ_MESSAGE_HISTORY, 'Read Message History'],
  [PERMISSION_BIT.MENTION_EVERYONE, 'Mention Everyone'],
  [PERMISSION_BIT.USE_EXTERNAL_EMOJIS, 'Use External Emojis'],
  [PERMISSION_BIT.CONNECT, 'Connect'],
  [PERMISSION_BIT.SPEAK, 'Speak'],
  [PERMISSION_BIT.MANAGE_ROLES, 'Manage Roles'],
  [PERMISSION_BIT.MANAGE_WEBHOOKS, 'Manage Webhooks'],
  [PERMISSION_BIT.MANAGE_EXPRESSIONS, 'Manage Expressions'],
  [PERMISSION_BIT.MANAGE_EVENTS, 'Manage Events'],
  [PERMISSION_BIT.MANAGE_THREADS, 'Manage Threads'],
  [PERMISSION_BIT.MODERATE_MEMBERS, 'Moderate Members'],
]);

export function formatPermissions(bits: readonly PermissionBit[]): string {
  return bits.map((bit) => PERMISSION_LABELS.get(bit) ?? `bit ${bit}`).join(', ');
}
