import type { Repositories } from '../database/repositories.js';
import { OwnerPolicy, renderTemplate } from '@dcbot/shared';
import { CooldownManager } from '../utils/cooldown.js';

/**
 * Optional branding system.
 *
 * Disabled by default. Even when enabled, replies only happen in explicitly
 * configured channels, are rate limited, and never fire on messages authored by
 * the bot itself (which would create a reply loop).
 */
export interface BrandingConfig {
  enabled: boolean;
  mode: 'off' | 'channels' | 'all';
  channelIds: string[];
  exemptUserIds: string[];
  template: string;
  color: number;
  footer: string;
  minIntervalSeconds: number;
  replyToEveryMessage: boolean;
}

export const DEFAULT_BRANDING: BrandingConfig = {
  enabled: false,
  mode: 'off',
  channelIds: [],
  exemptUserIds: [],
  template: '',
  color: 0x5865f2,
  footer: '',
  minIntervalSeconds: 30,
  // Explicit opt-in: the default must never reply to every message.
  replyToEveryMessage: false,
};

export class BrandingService {
  private readonly limits = new CooldownManager();

  constructor(
    private readonly repos: Repositories,
    private readonly owners: OwnerPolicy,
  ) {}

  async config(guildId: string): Promise<BrandingConfig> {
    const settings = await this.repos.guilds.getSettings(guildId);
    return { ...DEFAULT_BRANDING, ...((settings.branding ?? {}) as Partial<BrandingConfig>) };
  }

  /** Only configured bot owners may change branding. */
  async update(
    guildId: string,
    patch: Partial<BrandingConfig>,
    actorId: string,
  ): Promise<BrandingConfig> {
    this.owners.requireOwner(actorId, 'change branding settings');
    const config = { ...(await this.config(guildId)), ...patch };
    config.minIntervalSeconds = Math.max(5, Math.min(3600, config.minIntervalSeconds));
    config.channelIds = config.channelIds.slice(0, 50);
    config.exemptUserIds = config.exemptUserIds.slice(0, 200);
    // Safety: mode 'all' is only honoured together with the explicit flag.
    if (config.mode === 'all' && !config.replyToEveryMessage) config.mode = 'channels';
    await this.repos.guilds.updateSettingsGroup(
      guildId,
      'branding',
      config as unknown as Record<string, unknown>,
    );
    return config;
  }

  /**
   * Decides whether the bot should reply to a message. Returns null when it
   * should stay silent - the overwhelmingly common case.
   */
  async shouldRespond(params: {
    guildId: string;
    channelId: string;
    authorId: string;
    authorIsBot: boolean;
  }): Promise<string | null> {
    if (params.authorIsBot) return null; // Never reply to bots: prevents loops.
    const config = await this.config(params.guildId);
    if (!config.enabled || config.mode === 'off') return null;
    if (!config.template.trim()) return null;
    if (config.exemptUserIds.includes(params.authorId)) return null;
    if (config.mode === 'channels' && !config.channelIds.includes(params.channelId)) return null;

    const limit = this.limits.check(
      `branding:${params.guildId}:${params.channelId}`,
      1,
      config.minIntervalSeconds * 1000,
    );
    if (!limit.allowed) return null;

    return renderTemplate(
      config.template,
      { guild: params.guildId, channel: params.channelId, user: `<@${params.authorId}>` },
      {
        strict: false,
        maxLength: 1900,
      },
    );
  }
}
