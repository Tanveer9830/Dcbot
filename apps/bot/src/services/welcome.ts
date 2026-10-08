import { EmbedBuilder, type Guild, type GuildMember, type TextChannel, ChannelType } from 'discord.js';
import type { Repositories } from '../database/repositories.js';
import { renderTemplate } from '@dcbot/shared';
import type { Logger } from '../utils/logger.js';

export interface WelcomeConfig {
  enabled: boolean;
  channelId: string | null;
  message: string;
  leaveEnabled: boolean;
  leaveMessage: string;
  autoRoleIds: string[];
  dmOnJoin: boolean;
  verificationRoleId: string | null;
  verificationChannelId: string | null;
  verificationMessage: string;
}

export const DEFAULT_WELCOME: WelcomeConfig = {
  enabled: false,
  channelId: null,
  message: 'Welcome {{user}} to **{{guild}}**! You are member #{{member_count}}.',
  leaveEnabled: false,
  leaveMessage: '{{user}} has left the server.',
  autoRoleIds: [],
  dmOnJoin: false,
  verificationRoleId: null,
  verificationChannelId: null,
  verificationMessage: 'Click below to verify and unlock the server.',
};

export class WelcomeService {
  constructor(
    private readonly repos: Repositories,
    private readonly logger: Logger,
  ) {}

  async config(guildId: string): Promise<WelcomeConfig> {
    const settings = await this.repos.guilds.getSettings(guildId);
    return { ...DEFAULT_WELCOME, ...((settings.welcome ?? {}) as Partial<WelcomeConfig>) };
  }

  async update(guildId: string, patch: Partial<WelcomeConfig>): Promise<WelcomeConfig> {
    const config = { ...(await this.config(guildId)), ...patch };
    await this.repos.guilds.updateSettingsGroup(guildId, 'welcome', config as unknown as Record<string, unknown>);
    return config;
  }

  /** Builds the variables available to welcome/leave templates. */
  variables(member: GuildMember): Record<string, string> {
    return {
      user: `<@${member.id}>`,
      'user.id': member.id,
      'user.tag': member.user.tag,
      guild: member.guild.name,
      'guild.id': member.guild.id,
      member_count: String(member.guild.memberCount),
      date: new Date().toISOString(),
    };
  }

  /** Renders the configured message. Unknown variables are left blank (lenient). */
  render(template: string, member: GuildMember): string {
    return renderTemplate(template, this.variables(member), { strict: false, maxLength: 1900 });
  }

  async onMemberJoin(member: GuildMember): Promise<{ greeted: boolean; rolesAdded: string[] }> {
    const config = await this.config(member.guild.id);
    const rolesAdded: string[] = [];

    // Auto-roles are applied even when greetings are disabled.
    for (const roleId of config.autoRoleIds) {
      if (config.verificationRoleId && roleId === config.verificationRoleId) continue;
      try {
        await member.roles.add(roleId, 'Welcome auto-role');
        rolesAdded.push(roleId);
      } catch (error) {
        this.logger.warn('welcome: auto-role failed', {
          guildId: member.guild.id,
          roleId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (config.dmOnJoin) {
      const text = this.render(config.message, member);
      await member.send({ embeds: [new EmbedBuilder().setDescription(text).setColor(0x57f287)] }).catch(() => undefined);
    }

    if (!config.enabled || !config.channelId) return { greeted: rolesAdded.length > 0, rolesAdded };
    const channel = member.guild.channels.cache.get(config.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return { greeted: false, rolesAdded };

    try {
      await (channel as TextChannel).send({
        embeds: [
          new EmbedBuilder()
            .setDescription(this.render(config.message, member))
            .setColor(0x57f287)
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp(),
        ],
      });
      return { greeted: true, rolesAdded };
    } catch (error) {
      this.logger.warn('welcome: send failed', {
        guildId: member.guild.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return { greeted: false, rolesAdded };
    }
  }

  async onMemberLeave(member: GuildMember): Promise<boolean> {
    const config = await this.config(member.guild.id);
    if (!config.leaveEnabled || !config.channelId) return false;
    const channel = member.guild.channels.cache.get(config.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return false;
    try {
      await (channel as TextChannel).send({
        embeds: [new EmbedBuilder().setDescription(this.render(config.leaveMessage, member)).setColor(0xed4245).setTimestamp()],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Grants the verification role. The caller must have verified the button click. */
  async verify(guild: Guild, member: GuildMember): Promise<string> {
    const config = await this.config(guild.id);
    if (!config.verificationRoleId) throw new Error('Verification is not configured.');
    await member.roles.add(config.verificationRoleId, 'Verification accepted');
    return 'You are now verified.';
  }
}
