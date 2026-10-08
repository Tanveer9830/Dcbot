import { SlashCommandBuilder } from 'discord.js';
import {
  defineCommand,
  requireService,
  successEmbed,
  errorEmbed,
  ValidationError,
} from '../helpers.js';
import { formatNumber } from '../../utils/format.js';
import { PERMISSION_BIT } from '@dcbot/shared';

const economy = defineCommand({
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Virtual server economy (game currency only - no real money).')
    .addSubcommand((sub) =>
      sub
        .setName('balance')
        .setDescription('Shows a balance.')
        .addUserOption((option) => option.setName('user').setDescription('User (defaults to you)')),
    )
    .addSubcommand((sub) => sub.setName('daily').setDescription('Claims your daily reward.'))
    .addSubcommand((sub) => sub.setName('weekly').setDescription('Claims your weekly reward.'))
    .addSubcommand((sub) => sub.setName('work').setDescription('Works for a small reward.'))
    .addSubcommand((sub) =>
      sub
        .setName('pay')
        .setDescription('Sends coins to another member.')
        .addUserOption((option) =>
          option.setName('user').setDescription('Recipient').setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('amount').setDescription('Amount').setMinValue(1).setRequired(true),
        )
        .addStringOption((option) => option.setName('memo').setDescription('Optional note')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('deposit')
        .setDescription('Moves coins from wallet to bank.')
        .addIntegerOption((option) =>
          option.setName('amount').setDescription('Amount').setMinValue(1).setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('withdraw')
        .setDescription('Moves coins from bank to wallet.')
        .addIntegerOption((option) =>
          option.setName('amount').setDescription('Amount').setMinValue(1).setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('leaderboard').setDescription('Shows the richest members.'))
    .addSubcommand((sub) =>
      sub.setName('history').setDescription('Shows your recent transactions.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('admin')
        .setDescription('Adjusts a balance (staff only, always logged).')
        .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true))
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('Positive to add, negative to remove')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('reason').setDescription('Reason').setRequired(true),
        ),
    ),
  description: 'Virtual server economy.',
  async execute(ctx) {
    const service = requireService(ctx.context.services.economy, 'economy');
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();
    const guildId = ctx.guild.id;
    const userId = ctx.interaction.user.id;

    if (sub === 'balance') {
      const target = ctx.interaction.options.getUser('user') ?? ctx.interaction.user;
      const embed = await service.balanceEmbed(guildId, target.id);
      await ctx.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'daily' || sub === 'weekly' || sub === 'work') {
      const result = await service.claim(guildId, userId, sub);
      const config = await service.config(guildId);
      await ctx.reply({
        embeds: [
          successEmbed(
            `Claimed ${config.currencySymbol} ${formatNumber(result.amount)} ${config.currencyName}. Wallet: ${formatNumber(result.account.wallet)}.`,
          ),
        ],
      });
      return;
    }

    if (sub === 'pay') {
      const target = ctx.interaction.options.getUser('user', true);
      const amount = ctx.interaction.options.getInteger('amount', true);
      const memo = ctx.interaction.options.getString('memo') ?? undefined;
      const result = await service.pay({
        guildId,
        fromUserId: userId,
        toUserId: target.id,
        amount,
        memo,
        idempotencyKey: `${ctx.interaction.id}`,
      });
      const config = await service.config(guildId);
      await ctx.reply({
        embeds: [
          successEmbed(
            `Sent ${formatNumber(amount)} ${config.currencyName} to <@${target.id}>. Your wallet: ${formatNumber(result.sender.wallet)}.`,
          ),
        ],
      });
      return;
    }

    if (sub === 'deposit' || sub === 'withdraw') {
      const amount = ctx.interaction.options.getInteger('amount', true);
      const account =
        sub === 'deposit'
          ? await repos.economy.deposit(guildId, userId, amount)
          : await repos.economy.withdraw(guildId, userId, amount);
      await ctx.reply({
        embeds: [
          successEmbed(
            `Wallet: ${formatNumber(account.wallet)} | Bank: ${formatNumber(account.bank)}`,
          ),
        ],
      });
      return;
    }

    if (sub === 'leaderboard') {
      const rows = await service.leaderboard(guildId, 10);
      await ctx.reply({
        embeds: [
          {
            title: 'Economy leaderboard',
            color: 0xf1c40f,
            description: rows.map((row) => row.label).join('\n') || '_No balances yet._',
          },
        ],
      });
      return;
    }

    if (sub === 'history') {
      const rows = await repos.economy.ledger(guildId, userId, 10);
      await ctx.reply({
        embeds: [
          {
            title: 'Recent transactions',
            color: 0xf1c40f,
            description:
              rows
                .map(
                  (row) =>
                    `\`${row.createdAt.toISOString().slice(0, 16)}\` ${row.kind} ${row.amount > 0 ? '+' : ''}${formatNumber(row.amount)}`,
                )
                .join('\n')
                .slice(0, 4000) || '_No transactions yet._',
          },
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'admin') {
      const staff =
        ctx.member.permissions.has('ManageGuild') || ctx.member.permissions.has('BanMembers');
      if (!staff && !ctx.context.owners.isOwner(userId)) {
        await ctx.reply({ embeds: [errorEmbed('Staff only.')], ephemeral: true });
        return;
      }
      const target = ctx.interaction.options.getUser('user', true);
      const amount = ctx.interaction.options.getInteger('amount', true);
      const reason = ctx.interaction.options.getString('reason', true);
      const account = await repos.economy.adjust({
        guildId,
        userId: target.id,
        delta: amount,
        actorId: userId,
        reason,
      });
      await repos.audit.record({
        guildId,
        actorId: userId,
        action: 'economy.adjust',
        targetType: 'user',
        targetId: target.id,
        detail: { amount, reason },
      });
      await ctx.reply({
        embeds: [successEmbed(`${target}'s wallet is now ${formatNumber(account.wallet)}.`)],
      });
    }
  },
});

export default [economy];
export { PERMISSION_BIT };
