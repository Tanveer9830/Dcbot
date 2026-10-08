import type {
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildMember,
  InteractionReplyOptions,
  MessagePayload,
} from 'discord.js';
import type { Database } from '@dcbot/database';
import type { Env } from '@dcbot/config';
import type { OwnerPolicy, PermissionBit } from '@dcbot/shared';
import type { Repositories } from './database/repositories.js';
import type { CommandRegistry } from './commands/registry.js';
import type { ServiceRegistry } from './services/registry.js';
import type { Logger } from './utils/logger.js';

/** Everything a command or event handler is allowed to reach. */
export interface BotContext {
  env: Env;
  owners: OwnerPolicy;
  logger: Logger;
  db: Database | null;
  repos: Repositories | null;
  services: ServiceRegistry;
  /** Populated after command discovery so /help can introspect itself. */
  registry?: CommandRegistry;
  startedAt: number;
}

export interface CommandExecutionContext {
  interaction: ChatInputCommandInteraction;
  guild: Guild;
  member: GuildMember;
  context: BotContext;
  logger: Logger;
  /** Reply helper that converts DcbotError into a user-facing message. */
  reply: (options: string | InteractionReplyOptions | MessagePayload) => Promise<unknown>;
}

/**
 * Anything that can be serialised into the Discord application command payload.
 * discord.js builders all satisfy this; keeping the type structural avoids
 * fighting the builder's generic signatures.
 */
export interface CommandDataLike {
  toJSON(): unknown;
}

export interface SlashCommand {
  /** discord.js builder; `.toJSON()` is what gets registered. */
  data: CommandDataLike;
  description: string;
  /** Restrict to configured bot owners. Enforced before execute(). */
  ownerOnly?: boolean;
  /** Restrict to guild staff (Manage Guild / Ban Members / configured staff roles). */
  staffOnly?: boolean;
  /** Permissions the invoking member must have. */
  userPermissions?: readonly PermissionBit[];
  /** Permissions the bot itself needs; checked before executing. */
  clientPermissions?: readonly PermissionBit[];
  /** Per-user cooldown in ms. */
  cooldownMs?: number;
  /** False when the command also works in DMs. Default true (guild only). */
  guildOnly?: boolean;
  /** True when the command is safe without a database. */
  requiresDatabase?: boolean;
  execute: (ctx: CommandExecutionContext) => Promise<void>;
}

export interface BotEvent<K extends string = string> {
  name: K;
  once?: boolean;
  execute: (...args: never[]) => Promise<void> | void;
}
