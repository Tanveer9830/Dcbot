import { SlashCommandBuilder } from 'discord.js';
import { defineCommand, getTargetMember, requireService, successEmbed, ValidationError } from '../helpers.js';
import { PERMISSION_BIT } from '@dcbot/shared';

const rank = defineCommand({
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Shows your level and XP progress.')
    .addUserOption((option) => option.setName('user').setDescription('User (defaults to you)')),
  description: 'Shows your level and XP progress.',
  cooldownMs: 5000,
  async execute(ctx) {
    const service = requireService(ctx.context.services.leveling, 'leveling');
    const target = getTargetMember(ctx.interaction, 'user') ?? ctx.member;
    const embed = await service.rankEmbed(ctx.guild.id, target.id, target.displayName, target.user.displayAvatarURL());
    await ctx.reply({ embeds: [embed] });
  },
});

const leaderboard = defineCommand({
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Shows the XP leaderboard.'),
  description: 'Shows the XP leaderboard.',
  cooldownMs: 5000,
  async execute(ctx) {
    const service = requireService(ctx.context.services.leveling, 'leveling');
    const rows = await service.leaderboard(ctx.guild.id, 10);
    await ctx.reply({
      embeds: [
        {
          title: 'XP leaderboard',
          color: 0x5865f2,
          description: rows.map((row) => row.label).join('\n') || '_Nobody has XP yet._',
        },
      ],
    });
  },
});

const leveling = defineCommand({
  data: new SlashCommandBuilder()
    .setName('leveling')
    .setDescription('Configures XP and level rewards (staff only).')
    .addSubcommand((sub) => sub.setName('status').setDescription('Shows the current configuration.'))
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Enables or disables leveling.')
        .addBooleanOption((option) => option.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('multiplier')
        .setDescription('Sets the XP multiplier.')
        .addNumberOption((option) => option.setName('value').setDescription('0.1 - 10').setMinValue(0.1).setMaxValue(10).setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reward')
        .setDescription('Grants a role at a level.')
        .addIntegerOption((option) => option.setName('level').setDescription('Level').setMinValue(1).setMaxValue(500).setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('setxp')
        .setDescription('Sets a member\'s XP directly (logged).')
        .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true))
        .addIntegerOption((option) => option.setName('xp').setDescription('Total XP').setMinValue(0).setRequired(true)),
    ),
  description: 'Configures XP and level rewards.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_GUILD],
  async execute(ctx) {
    const service = requireService(ctx.context.services.leveling, 'leveling');
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'status') {
      const config = await service.config(ctx.guild.id);
      const rewards = await repos.leveling.roleRewards(ctx.guild.id);
      await ctx.reply({
        embeds: [
          {
            title: 'Leveling',
            color: 0x5865f2,
            fields: [
              { name: 'Enabled', value: String(config.enabled), inline: true },
              { name: 'XP per message', value: `${config.xpMin}-${config.xpMax}`, inline: true },
              { name: 'Cooldown', value: `${config.cooldownSeconds}s`, inline: true },
              { name: 'Multiplier', value: `${config.multiplier}x`, inline: true },
              { name: 'Announce level ups', value: String(config.announceLevelUp), inline: true },
              {
                name: 'Role rewards',
                value: rewards.map((reward) => `level ${reward.level} → <@&${reward.roleId}>`).join('\n').slice(0, 1000) || '_none_',
              },
            ],
          },
        ],
      });
      return;
    }

    if (sub === 'enable') {
      const enabled = ctx.interaction.options.getBoolean('enabled', true);
      await service.update(ctx.guild.id, { enabled });
      await ctx.reply({ embeds: [successEmbed(`Leveling ${enabled ? 'enabled' : 'disabled'}.`)] });
      return;
    }

    if (sub === 'multiplier') {
      const value = ctx.interaction.options.getNumber('value', true);
      const config = await service.update(ctx.guild.id, { multiplier: value });
      await ctx.reply({ embeds: [successEmbed(`XP multiplier set to ${config.multiplier}x.`)] });
      return;
    }

    if (sub === 'reward') {
      const level = ctx.interaction.options.getInteger('level', true);
      const role = ctx.interaction.options.getRole('role', true);
      await repos.leveling.setRoleReward(ctx.guild.id, level, role.id);
      await ctx.reply({ embeds: [successEmbed(`Level ${level} now grants ${role}.`)] });
      return;
    }

    if (sub === 'setxp') {
      const target = ctx.interaction.options.getUser('user', true);
      const xp = ctx.interaction.options.getInteger('xp', true);
      const profile = await repos.leveling.setXp(ctx.guild.id, target.id, xp);
      await repos.audit.record({
        guildId: ctx.guild.id,
        actorId: ctx.interaction.user.id,
        action: 'leveling.setxp',
        targetType: 'user',
        targetId: target.id,
        detail: { xp },
      });
      await ctx.reply({ embeds: [successEmbed(`${target} is now level ${profile.level} with ${profile.xp} XP.`)] });
    }
  },
});

export default [rank, leaderboard, leveling];
