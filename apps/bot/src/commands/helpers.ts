import { EmbedBuilder, GuildMember, type ChatInputCommandInteraction } from 'discord.js';
import { ValidationError } from '@dcbot/shared';

export { ValidationError };
import type { CommandExecutionContext, SlashCommand } from '../types.js';

/** Identity helper so each command file reads as a plain object. */
export function defineCommand(command: SlashCommand): SlashCommand {
  return command;
}

export const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  warning: 0xfaa61a,
  danger: 0xed4245,
  neutral: 0x2b2d31,
} as const;

export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.danger).setDescription(`❌ ${message}`);
}

export function successEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.success).setDescription(`✅ ${message}`);
}

export function infoEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.primary).setDescription(message);
}

/**
 * Commands that need persistence call this first. Without a database the bot
 * still runs, but persistent features refuse cleanly instead of throwing.
 */
export function requireDatabase(ctx: CommandExecutionContext): NonNullable<typeof ctx.context.repos> {
  if (!ctx.context.repos) {
    throw new ValidationError('This feature needs the database, which is not configured on this instance.');
  }
  return ctx.context.repos;
}

export function requireService<T>(service: T | undefined, name: string): T {
  if (!service) {
    throw new ValidationError(`The ${name} subsystem is not available on this instance.`);
  }
  return service;
}

/**
 * Resolves a user option to a real GuildMember.
 *
 * discord.js can return a raw API object when the member is not cached; that
 * shape has no role hierarchy or moderation helpers, so treat it as "not found"
 * rather than passing a half-object into moderation code.
 */
export function getTargetMember(
  interaction: ChatInputCommandInteraction,
  name: string,
): GuildMember | null {
  const value = interaction.options.getMember(name);
  return value instanceof GuildMember ? value : null;
}

/** True when the invoking member holds Manage Guild or Ban Members. */
export function isStaff(ctx: CommandExecutionContext): boolean {
  return (
    ctx.member.permissions.has('ManageGuild') ||
    ctx.member.permissions.has('BanMembers') ||
    ctx.member.permissions.has('Administrator')
  );
}

/** Renders a key/value list as embed fields. */
export function fieldsFrom(entries: Array<[string, string | number | null | undefined]>): Array<{
  name: string;
  value: string;
  inline: boolean;
}> {
  return entries
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => ({ name, value: String(value), inline: true }));
}
