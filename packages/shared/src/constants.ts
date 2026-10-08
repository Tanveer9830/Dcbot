/**
 * Platform limits and defaults.
 *
 * Every number in this file reflects a documented Discord API limit or a
 * conservative internal default. They exist so the command hierarchy, message
 * sizes and batch operations can be validated *before* Discord rejects them.
 */
export const DISCORD_LIMITS = {
  /** Maximum top-level application commands per application per scope. */
  MAX_TOP_LEVEL_COMMANDS: 100,
  /** Maximum subcommands + subcommand groups per top-level command. */
  MAX_SUBCOMMANDS_PER_COMMAND: 25,
  /** Maximum nested subcommand groups per command. */
  MAX_SUBCOMMAND_GROUPS: 25,
  /** Maximum subcommands inside a single subcommand group. */
  MAX_SUBCOMMANDS_PER_GROUP: 25,
  /** Maximum options per command. */
  MAX_OPTIONS_PER_COMMAND: 25,
  /** Maximum length of a command name. */
  MAX_COMMAND_NAME_LENGTH: 32,
  /** Maximum length of a command description. */
  MAX_DESCRIPTION_LENGTH: 100,
  /** Maximum number of message IDs per bulk delete call. */
  MAX_BULK_DELETE: 100,
  /** Messages older than this cannot be bulk deleted (14 days). */
  BULK_DELETE_MAX_AGE_MS: 14 * 24 * 60 * 60 * 1000,
  /** Maximum embed description length. */
  MAX_EMBED_DESCRIPTION: 4096,
  /** Maximum embed title length. */
  MAX_EMBED_TITLE: 256,
  /** Maximum embed fields. */
  MAX_EMBED_FIELDS: 25,
  /** Maximum message content length. */
  MAX_MESSAGE_CONTENT: 2000,
  /** Maximum roles per guild. */
  MAX_ROLES_PER_GUILD: 250,
  /** Timeout duration limits enforced by Discord. */
  MAX_TIMEOUT_MS: 28 * 24 * 60 * 60 * 1000,
} as const;

export const DEFAULTS = {
  /** Cooldown applied when a command does not declare one. */
  COMMAND_COOLDOWN_MS: 3_000,
  /** Minimum interval between two XP grants for the same user. */
  XP_COOLDOWN_MS: 60_000,
  XP_PER_MESSAGE_MIN: 15,
  XP_PER_MESSAGE_MAX: 25,
  /** Economy defaults. */
  ECONOMY_DAILY_MIN: 200,
  ECONOMY_DAILY_MAX: 500,
  ECONOMY_WEEKLY_MIN: 1000,
  ECONOMY_WEEKLY_MAX: 2500,
  ECONOMY_STARTING_BALANCE: 500,
  /** Security defaults. */
  ANTI_RAID_JOIN_WINDOW_MS: 10_000,
  ANTI_RAID_JOIN_THRESHOLD: 5,
  ANTI_SPAM_WINDOW_MS: 5_000,
  ANTI_SPAM_THRESHOLD: 5,
  ANTI_MENTION_THRESHOLD: 10,
  ANTI_CAPS_RATIO: 0.7,
  ANTI_CAPS_MIN_LENGTH: 20,
  /** Branding defaults - OFF by default to avoid spam. */
  BRANDING_ENABLED_BY_DEFAULT: false,
} as const;

/** Snowflakes are 17-20 digit numeric strings. */
export const SNOWFLAKE_REGEX = /^[0-9]{15,25}$/;

/** Command names accepted by Discord's application command API. */
export const COMMAND_NAME_REGEX = /^[a-z0-9](?:[a-z0-9_-]{0,31})$/;

/** Guild custom command names are validated by this stricter pattern. */
export const CUSTOM_COMMAND_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export const PERMISSION_BIT = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_EVENTS: 1n << 33n,
  MODERATE_MEMBERS: 1n << 40n,
  MANAGE_THREADS: 1n << 34n,
  MANAGE_EXPRESSIONS: 1n << 30n,
} as const;

export type PermissionBit = (typeof PERMISSION_BIT)[keyof typeof PERMISSION_BIT];
