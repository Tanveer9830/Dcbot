import {
  Events,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
} from 'discord.js';
import { DcbotError, ValidationError, maskId } from '@dcbot/shared';
import type { BotContext, CommandExecutionContext } from '../types.js';
import { errorEmbed } from './index.js';
import { CooldownManager } from '../utils/cooldown.js';

const REPLY_TIMEOUT_MS = 2_500;

/**
 * Central interaction dispatcher.
 *
 * Order of operations for every chat input command:
 *  1. guild/DM scope check
 *  2. authorization (owner > staff > user permissions > client permissions)
 *  3. cooldown
 *  4. database requirement
 *  5. execute, with a single place that converts errors into user messages
 */
export function registerInteractionHandler(client: Client, ctx: BotContext, cooldowns: CooldownManager): void {
  const logger = ctx.logger.child({ scope: 'interaction' });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, ctx, cooldowns);
        return;
      }
      if (interaction.isButton()) {
        await handleButton(interaction, ctx);
        return;
      }
      if (interaction.isAutocomplete()) {
        const command = ctx.registry?.get(interaction.commandName);
        if (command && 'autocomplete' in command) {
          await (command as { autocomplete?: (i: unknown) => Promise<void> }).autocomplete?.(interaction);
        }
        return;
      }
    } catch (error) {
      await respondWithError(interaction, error, logger);
    }
  });
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
  cooldowns: CooldownManager,
): Promise<void> {
  const registry = ctx.registry;
  if (!registry) {
    await interaction.reply({ content: 'Commands are still loading.', ephemeral: true });
    return;
  }
  const command = registry.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ content: `Unknown command \`${interaction.commandName}\`.`, ephemeral: true });
    return;
  }

  const isOwner = ctx.owners.isOwner(interaction.user.id);

  if ((command.guildOnly ?? true) && !interaction.inGuild()) {
    await interaction.reply({ content: 'This command only works inside a server.', ephemeral: true });
    return;
  }

  if (interaction.inGuild() && !isOwner) {
    const guild = interaction.guild;
    const member = interaction.member;
    if (!guild || !member || typeof member.permissions === 'string') {
      await interaction.reply({ content: 'Could not resolve your permissions.', ephemeral: true });
      return;
    }
    const staffRoleIds = ctx.repos ? await ctx.repos.security.trustedRoleIds(guild.id) : [];
    const trustedUserIds = ctx.repos ? await ctx.repos.security.trustedUserIds(guild.id) : [];

    const guildMember = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!guildMember) {
      await interaction.reply({ content: 'Could not resolve your membership.', ephemeral: true });
      return;
    }

    const denial = registry.authorize({
      command,
      userId: interaction.user.id,
      memberPermissions: BigInt(member.permissions.bitfield ?? 0n),
      clientPermissions: BigInt(guild.members.me?.permissions.bitfield ?? 0n),
      memberRoleIds: [...guildMember.roles.cache.keys()],
      staffRoleIds,
      trustedUserIds,
      owners: ctx.owners,
    });
    if (denial) {
      await interaction.reply({ content: denial.message, ephemeral: true });
      return;
    }

    const retryAfter = registry.applyCooldown(command, interaction.user.id, guild.id);
    if (retryAfter > 0) {
      await interaction.reply({
        content: `Slow down - try again in ${(retryAfter / 1000).toFixed(1)}s.`,
        ephemeral: true,
      });
      return;
    }

    if (command.requiresDatabase !== false && !ctx.repos) {
      await interaction.reply({
        content: 'This command needs the database, which is not configured on this instance.',
        ephemeral: true,
      });
      return;
    }

    const commandCtx: CommandExecutionContext = {
      interaction,
      guild,
      member: guildMember,
      context: ctx,
      logger: ctx.logger.child({ command: interaction.commandName, guildId: guild.id }),
      reply: (options) =>
        interaction.deferred || interaction.replied
          ? interaction.editReply(options as never)
          : interaction.reply(options as never),
    };

    await runWithTimeout(command.execute(commandCtx), interaction, ctx);
    return;
  }

  // Owner path (works in DMs too).
  const commandCtx: CommandExecutionContext = {
    interaction,
    guild: interaction.guild!,
    member: interaction.member as never,
    context: ctx,
    logger: ctx.logger.child({ command: interaction.commandName }),
    reply: (options) =>
      interaction.deferred || interaction.replied
        ? interaction.editReply(options as never)
        : interaction.reply(options as never),
  };

  if (command.ownerOnly) {
    ctx.owners.requireOwner(interaction.user.id);
  }
  await runWithTimeout(command.execute(commandCtx), interaction, ctx);
}

async function runWithTimeout(
  work: Promise<void>,
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  let acknowledged = false;
  const timer = setTimeout(() => {
    acknowledged = true;
    interaction
      .deferReply({ flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
  }, REPLY_TIMEOUT_MS);

  try {
    await work;
  } finally {
    clearTimeout(timer);
  }
  if (acknowledged && !(interaction.replied || interaction.deferred)) {
    ctx.logger.debug('interaction acknowledged late', { command: interaction.commandName });
  }
}

async function respondWithError(
  interaction: Interaction,
  error: unknown,
  logger: { error: (message: string, extra?: Record<string, unknown>) => void },
): Promise<void> {
  const payload = { content: '', embeds: [errorEmbed(describeError(error))], ephemeral: true };
  try {
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload as never);
      else await interaction.reply(payload as never);
    }
  } catch {
    // The interaction window may already have expired.
  }

  if (error instanceof DcbotError && error.userFacing) {
    logger.error('command failed (user facing)', {
      code: error.code,
      user: maskId(interaction.user.id),
      message: error.message,
    });
    return;
  }
  logger.error('command failed (unexpected)', {
    user: maskId(interaction.user.id),
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

/** Deliberately avoids leaking internals into user-visible text. */
function describeError(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  if (error instanceof DcbotError && error.userFacing) return error.message;
  return 'Something went wrong running that command. It has been logged.';
}

/**
 * Button dispatcher for components the bot posts (tickets, giveaways, polls).
 * Each branch re-checks authorization server-side; nothing trusts the clicker.
 */
async function handleButton(interaction: ButtonInteraction, ctx: BotContext): Promise<void> {
  const id = interaction.customId;

  if (id.startsWith('ticket_open')) {
    const tickets = ctx.services.tickets;
    if (!tickets || !interaction.inCachedGuild()) {
      await interaction.reply({ content: 'Tickets are unavailable.', ephemeral: true });
      return;
    }
    const category = id.split(':')[1];
    try {
      const result = await tickets.open({
        guild: interaction.guild,
        openerId: interaction.user.id,
        category,
      });
      await interaction.reply({ content: result.message, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: describeError(error), ephemeral: true });
    }
    return;
  }

  if (id === 'ticket_claim' && interaction.inCachedGuild()) {
    const tickets = ctx.services.tickets;
    if (!tickets) return;
    const message = await tickets.claim(interaction.guild, interaction.channelId, interaction.user.id);
    await interaction.reply({ content: message });
    return;
  }

  if (id === 'ticket_close' && interaction.inCachedGuild()) {
    const tickets = ctx.services.tickets;
    if (!tickets) return;
    await tickets.close({ guild: interaction.guild, channelId: interaction.channelId, closedById: interaction.user.id });
    return;
  }

  if (id === 'giveaway_enter' && interaction.inCachedGuild()) {
    const giveaways = ctx.services.giveaways;
    if (!giveaways) return;
    const result = await giveaways.enter(interaction.guild.id, interaction.message.id, interaction.user.id);
    await interaction.reply({
      content: result.entered ? `Entered (${result.total} total).` : 'You are already entered.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ content: 'That button is no longer active.', ephemeral: true });
}
