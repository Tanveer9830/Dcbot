import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { defineCommand, COLORS } from '../helpers.js';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Shows gateway latency and database reachability.'),
  description: 'Shows gateway latency and database reachability.',
  requiresDatabase: false,
  cooldownMs: 5000,
  async execute(ctx) {
    const db = ctx.context.db ? await ctx.context.db.ping() : null;
    const embed = new EmbedBuilder()
      .setTitle('Pong')
      .setColor(COLORS.success)
      .addFields(
        { name: 'Gateway', value: `${Math.round(ctx.interaction.client.ws.ping)} ms`, inline: true },
        { name: 'Shard', value: String(ctx.interaction.guild?.shardId ?? 0), inline: true },
        {
          name: 'Database',
          value: db ? (db.ok ? `${db.latencyMs} ms` : 'unreachable') : 'not configured',
          inline: true,
        },
        {
          name: 'Uptime',
          value: `${Math.round((Date.now() - ctx.context.startedAt) / 1000)}s`,
          inline: true,
        },
      );
    await ctx.reply({ embeds: [embed] });
  },
});
