import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { defineCommand, COLORS } from '../helpers.js';
import { sendPaginated, paginate } from '../../utils/pagination.js';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Lists every command, or shows details for one.')
    .addStringOption((option) => option.setName('command').setDescription('Command to inspect')),
  description: 'Lists every command, or shows details for one.',
  guildOnly: false,
  requiresDatabase: false,
  cooldownMs: 5000,
  async execute(ctx) {
    const registry = ctx.context.registry;
    const target = ctx.interaction.options.getString('command');

    if (target && registry) {
      const command = registry.get(target.toLowerCase());
      if (!command) {
        await ctx.reply({ content: `No command named \`${target}\`.`, ephemeral: true });
        return;
      }
      const json = command.data.toJSON() as unknown as {
        name: string;
        description: string;
        options?: Array<Record<string, unknown>>;
      };
      const subs = (json.options ?? []).filter((option) => option.type === 1 || option.type === 2);
      const embed = new EmbedBuilder()
        .setTitle(`/${json.name}`)
        .setDescription(json.description)
        .setColor(COLORS.primary)
        .addFields(
          { name: 'Owner only', value: command.ownerOnly ? 'Yes' : 'No', inline: true },
          { name: 'Staff only', value: command.staffOnly ? 'Yes' : 'No', inline: true },
          { name: 'Cooldown', value: `${(command.cooldownMs ?? 3000) / 1000}s`, inline: true },
        );
      if (subs.length > 0) {
        embed.addFields({
          name: `Subcommands (${subs.length})`,
          value: subs
            .map((sub) => `\`${String(sub.name)}\` - ${String(sub.description ?? '')}`)
            .join('\n')
            .slice(0, 1024),
        });
      }
      await ctx.reply({ embeds: [embed] });
      return;
    }

    const commands = registry?.list() ?? [];
    const ownerIds = ctx.context.owners;
    const visible = commands.filter(
      (command) => !command.ownerOnly || ownerIds.isOwner(ctx.interaction.user.id),
    );
    const lines = visible.map((command) => {
      const json = command.data.toJSON() as unknown as { name: string; description: string };
      return `**/${json.name}** - ${json.description}`;
    });
    const pages = paginate(lines, 10).map((chunk) => ({
      title: `Commands (${visible.length})`,
      lines: chunk,
    }));
    await sendPaginated(ctx.interaction, pages);
  },
});
