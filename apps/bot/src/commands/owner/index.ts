import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import {
  defineCommand,
  requireService,
  successEmbed,
  errorEmbed,
  ValidationError,
} from '../helpers.js';
import { formatBytes, formatDuration } from '../../utils/format.js';
import { findUnknownVariables } from '@dcbot/shared';

/**
 * Owner-only global custom commands.
 *
 * `ownerOnly: true` makes the registry reject non-owners before execute() runs,
 * and the repository re-checks ownership on every write. Server Administrators
 * do not get access.
 */
const globalcommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('globalcommand')
    .setDescription('[Owner] Manage global custom commands available in every server.')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Creates a global custom command.')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('2-32 lowercase letters/numbers/_-')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Shown in the command list')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription('Response type')
            .addChoices({ name: 'text', value: 'text' }, { name: 'embed', value: 'embed' }),
        )
        .addStringOption((option) =>
          option.setName('content').setDescription('Text response (supports {{variables}})'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edits an existing global command.')
        .addStringOption((option) =>
          option.setName('name').setDescription('Command name').setRequired(true),
        )
        .addStringOption((option) => option.setName('content').setDescription('New text response'))
        .addStringOption((option) =>
          option.setName('description').setDescription('New description'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Deletes a global command.')
        .addStringOption((option) =>
          option.setName('name').setDescription('Command name').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lists global commands.'))
    .addSubcommand((sub) =>
      sub
        .setName('publish')
        .setDescription('Enables a global command.')
        .addStringOption((option) =>
          option.setName('name').setDescription('Command name').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('Disables a global command.')
        .addStringOption((option) =>
          option.setName('name').setDescription('Command name').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('preview')
        .setDescription('Renders a command without publishing it.')
        .addStringOption((option) =>
          option.setName('name').setDescription('Command name').setRequired(true),
        ),
    ),
  description: '[Owner] Manage global custom commands.',
  ownerOnly: true,
  guildOnly: false,
  requiresDatabase: true,
  async execute(ctx) {
    const service = requireService(ctx.context.services.customCommands, 'custom commands');
    const actorId = ctx.interaction.user.id;
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'create') {
      const content = ctx.interaction.options.getString('content');
      const type = (ctx.interaction.options.getString('type') ?? 'text') as 'text' | 'embed';
      if (type === 'text' && !content)
        throw new ValidationError('Provide content for a text command.');
      if (content) {
        const unknown = findUnknownVariables(content);
        if (unknown.length > 0)
          throw new ValidationError(`Unknown template variable(s): ${unknown.join(', ')}.`);
      }
      const command = await service.createGlobal({
        name: ctx.interaction.options.getString('name', true),
        description: ctx.interaction.options.getString('description', true),
        responseType: type,
        content: content ?? undefined,
        embed: type === 'embed' ? { description: content ?? '' } : undefined,
        actorId,
      });
      await ctx.reply({
        embeds: [successEmbed(`Created global command \`${command.name}\`.`)],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'edit') {
      const command = await service.updateGlobal(
        ctx.interaction.options.getString('name', true),
        {
          ...(ctx.interaction.options.getString('content')
            ? { content: ctx.interaction.options.getString('content') }
            : {}),
          ...(ctx.interaction.options.getString('description')
            ? { description: ctx.interaction.options.getString('description') }
            : {}),
        },
        actorId,
      );
      await ctx.reply({ embeds: [successEmbed(`Updated \`${command.name}\`.`)], ephemeral: true });
      return;
    }

    if (sub === 'delete') {
      const name = ctx.interaction.options.getString('name', true);
      const deleted = await service.deleteGlobal(name, actorId);
      await ctx.reply({
        embeds: [deleted ? successEmbed(`Deleted \`${name}\`.`) : errorEmbed('No such command.')],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'list') {
      const rows = await service.listGlobal();
      await ctx.reply({
        embeds: [
          {
            title: `Global commands (${rows.length})`,
            color: 0x5865f2,
            description:
              rows
                .map((row) => `\`${row.name}\` - ${row.description} ${row.enabled ? '✅' : '⛔'}`)
                .join('\n')
                .slice(0, 4000) || '_none_',
          },
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'publish' || sub === 'disable') {
      const command = await service.publishGlobal(
        ctx.interaction.options.getString('name', true),
        sub === 'publish',
        actorId,
      );
      await ctx.reply({
        embeds: [
          successEmbed(`\`${command.name}\` is now ${command.enabled ? 'published' : 'disabled'}.`),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'preview') {
      const rendered = await service.previewGlobal(
        ctx.interaction.options.getString('name', true),
        actorId,
        {
          guild: ctx.guild?.name ?? 'unknown',
          user: `<@${actorId}>`,
        },
      );
      await ctx.reply({
        content: rendered.content,
        embeds: rendered.embeds,
        ephemeral: true,
      });
    }
  },
});

const branding = defineCommand({
  data: new SlashCommandBuilder()
    .setName('branding')
    .setDescription('[Owner] Optional branded responses. Disabled by default.')
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Shows the current branding configuration.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Enables or disables branding in this server.')
        .addBooleanOption((option) =>
          option.setName('enabled').setDescription('Enabled').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('template')
        .setDescription('Sets the response template.')
        .addStringOption((option) =>
          option.setName('text').setDescription('Template text').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Adds or removes a channel where branding may respond.')
        .addChannelOption((option) =>
          option.setName('channel').setDescription('Channel').setRequired(true),
        )
        .addBooleanOption((option) =>
          option.setName('remove').setDescription('Remove instead of add'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('interval')
        .setDescription('Sets the minimum seconds between responses.')
        .addIntegerOption((option) =>
          option
            .setName('seconds')
            .setDescription('5-3600')
            .setMinValue(5)
            .setMaxValue(3600)
            .setRequired(true),
        ),
    ),
  description: '[Owner] Optional branded responses.',
  ownerOnly: true,
  async execute(ctx) {
    const service = requireService(ctx.context.services.branding, 'branding');
    const actorId = ctx.interaction.user.id;
    const sub = ctx.interaction.options.getSubcommand();
    const config = await service.config(ctx.guild.id);

    if (sub === 'status') {
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Branding')
            .setColor(0x5865f2)
            .addFields(
              { name: 'Enabled', value: String(config.enabled), inline: true },
              { name: 'Mode', value: config.mode, inline: true },
              { name: 'Channels', value: String(config.channelIds.length), inline: true },
              { name: 'Interval', value: `${config.minIntervalSeconds}s`, inline: true },
              {
                name: 'Reply to every message',
                value: String(config.replyToEveryMessage),
                inline: true,
              },
              { name: 'Template', value: config.template || '_none_' },
            ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'enable') {
      const updated = await service.update(
        ctx.guild.id,
        { enabled: ctx.interaction.options.getBoolean('enabled', true) },
        actorId,
      );
      await ctx.reply({
        content: `Branding ${updated.enabled ? 'enabled' : 'disabled'}.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'template') {
      await service.update(
        ctx.guild.id,
        { template: ctx.interaction.options.getString('text', true) },
        actorId,
      );
      await ctx.reply({ content: 'Template updated.', ephemeral: true });
      return;
    }

    if (sub === 'channel') {
      const channel = ctx.interaction.options.getChannel('channel', true);
      const remove = ctx.interaction.options.getBoolean('remove') ?? false;
      const channelIds = remove
        ? config.channelIds.filter((id) => id !== channel.id)
        : [...new Set([...config.channelIds, channel.id])];
      await service.update(
        ctx.guild.id,
        { channelIds, mode: channelIds.length > 0 ? 'channels' : 'off' },
        actorId,
      );
      await ctx.reply({ content: 'Channel list updated.', ephemeral: true });
      return;
    }

    if (sub === 'interval') {
      const updated = await service.update(
        ctx.guild.id,
        { minIntervalSeconds: ctx.interaction.options.getInteger('seconds', true) },
        actorId,
      );
      await ctx.reply({
        content: `Minimum interval is now ${updated.minIntervalSeconds}s.`,
        ephemeral: true,
      });
    }
  },
});

const guilds = defineCommand({
  data: new SlashCommandBuilder()
    .setName('guilds')
    .setDescription('[Owner] Lists the servers this bot is in.'),
  description: '[Owner] Lists the servers this bot is in.',
  ownerOnly: true,
  guildOnly: false,
  requiresDatabase: false,
  async execute(ctx) {
    const list = ctx.interaction.client.guilds.cache
      .sort((a, b) => b.memberCount - a.memberCount)
      .first(20)
      .map(
        (guild, index) =>
          `${index + 1}. **${guild.name}** - ${guild.memberCount} members (\`${guild.id}\`)`,
      );
    await ctx.reply({
      embeds: [
        {
          title: `Servers (${ctx.interaction.client.guilds.cache.size})`,
          color: 0x5865f2,
          description: list.join('\n').slice(0, 4000) || '_none_',
        },
      ],
      ephemeral: true,
    });
  },
});

const health = defineCommand({
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('[Owner] Shows live process and dependency health.'),
  description: '[Owner] Shows live process and dependency health.',
  ownerOnly: true,
  guildOnly: false,
  requiresDatabase: false,
  async execute(ctx) {
    const service = requireService(ctx.context.services.health, 'health');
    const snapshot = await service.snapshot({
      gatewayPingMs: Math.round(ctx.interaction.client.ws.ping),
      wsStatus: String(ctx.interaction.client.ws.status),
      guildCount: ctx.interaction.client.guilds.cache.size,
      userCount: ctx.interaction.client.users.cache.size,
    });
    const memory = process.memoryUsage();
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Health')
          .setColor(snapshot.status === 'ok' ? 0x57f287 : 0xfaa61a)
          .addFields(
            { name: 'Status', value: snapshot.status, inline: true },
            { name: 'Uptime', value: snapshot.uptimeHuman, inline: true },
            { name: 'Gateway', value: `${snapshot.gatewayPingMs ?? 'n/a'} ms`, inline: true },
            { name: 'Guilds', value: String(snapshot.guildCount), inline: true },
            { name: 'Heap', value: formatBytes(memory.heapUsed), inline: true },
            { name: 'RSS', value: formatBytes(memory.rss), inline: true },
            {
              name: 'Load (1m)',
              value: `${snapshot.cpu.load1} / ${snapshot.cpu.cores} cores`,
              inline: true,
            },
            { name: 'Node', value: snapshot.node, inline: true },
            {
              name: 'Services',
              value: snapshot.services
                .map(
                  (entry) =>
                    `${entry.service}: **${entry.status}**${entry.latencyMs !== undefined && entry.latencyMs !== null ? ` (${entry.latencyMs}ms)` : ''}${entry.detail ? ` - ${entry.detail}` : ''}`,
                )
                .join('\n'),
            },
            {
              name: 'Started',
              value: formatDuration(Date.now() - ctx.context.startedAt),
              inline: true,
            },
          ),
      ],
      ephemeral: true,
    });
  },
});

export default [globalcommand, branding, guilds, health];
