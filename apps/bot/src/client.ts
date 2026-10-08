import { Client, GatewayIntentBits, Options, type ClientOptions } from 'discord.js';
import type { BotContext } from './types.js';

/**
 * Intents requested by this bot, and why:
 *  - Guilds / GuildMembers: moderation, welcome, roles, tickets
 *  - GuildMessages / MessageContent: automod, anti-spam, /no-tag detection,
 *    XP, starboard. MessageContent is a privileged intent and must be enabled
 *    in the developer portal.
 *  - GuildMessageReactions: reaction roles, starboard
 *  - GuildVoiceStates: music player lifecycle
 *  - GuildPresences is intentionally NOT requested (unused).
 *  - GuildModeration: audit-log based anti-nuke attribution.
 */
export const REQUIRED_INTENTS: readonly GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
] as const;

export function buildClientOptions(context: BotContext): ClientOptions {
  return {
    intents: [...REQUIRED_INTENTS],
    allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
    partials: [],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 200,
      PresenceManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 300, lifetime: 600 },
    },
    rest: { retries: 3 },
    failIfNotExists: false,
    // Keeps the client honest about who owns it in logs.
    presence: undefined,
    ...(context ? {} : {}),
  };
}

export class DcbotClient extends Client {
  constructor(public readonly ctx: BotContext) {
    super(buildClientOptions(ctx));
  }

  /** Uptime in ms since the process started. */
  get processUptimeMs(): number {
    return Date.now() - this.ctx.startedAt;
  }
}
