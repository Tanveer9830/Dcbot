import { ChannelType, EmbedBuilder, SlashCommandBuilder, type TextChannel } from 'discord.js';
import {
  defineCommand,
  requireService,
  successEmbed,
  errorEmbed,
  ValidationError,
} from '../helpers.js';
import { discordTimestamp, parseDuration } from '../../utils/format.js';
import { PERMISSION_BIT } from '@dcbot/shared';

const giveaway = defineCommand({
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Runs giveaways.')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Starts a giveaway in this channel.')
        .addStringOption((option) =>
          option.setName('prize').setDescription('What is being given away').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('duration').setDescription('e.g. 1h, 30m, 2d').setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('winners').setDescription('Winner count').setMinValue(1).setMaxValue(25),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('Ends a giveaway now.')
        .addStringOption((option) =>
          option.setName('message_id').setDescription('Giveaway message ID').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lists active giveaways.')),
  description: 'Runs giveaways.',
  async execute(ctx) {
    const service = requireService(ctx.context.services.giveaways, 'giveaways');
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'start') {
      if (!ctx.member.permissions.has('ManageGuild')) throw new ValidationError('Staff only.');
      const channel = ctx.interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText)
        throw new ValidationError('Use this in a text channel.');
      const ms = parseDuration(ctx.interaction.options.getString('duration', true));
      if (ms === null)
        throw new ValidationError('Could not read that duration. Try `1h` or `30m`.');
      const result = await service.start({
        guild: ctx.guild,
        channel: channel as TextChannel,
        hostId: ctx.interaction.user.id,
        prize: ctx.interaction.options.getString('prize', true),
        winnerCount: ctx.interaction.options.getInteger('winners') ?? 1,
        durationMs: ms,
      });
      await ctx.reply({
        content: `Giveaway started: <#${channel.id}> ends ${discordTimestamp(result.endsAt, 'R')}.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'end') {
      if (!ctx.member.permissions.has('ManageGuild')) throw new ValidationError('Staff only.');
      const message = await service.end(
        ctx.guild,
        ctx.interaction.options.getString('message_id', true),
      );
      await ctx.reply({ content: message, ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const rows = await repos.community.activeGiveaways(ctx.guild.id);
      await ctx.reply({
        embeds: [
          {
            title: `Active giveaways (${rows.length})`,
            color: 0xf1c40f,
            description:
              rows
                .map(
                  (row) =>
                    `**${row.prize}** - ends ${discordTimestamp(row.endsAt, 'R')} (${row.winnerCount} winner(s))`,
                )
                .join('\n')
                .slice(0, 4000) || '_none_',
          },
        ],
      });
    }
  },
});

const suggest = defineCommand({
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Suggestion system.')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Posts a suggestion.')
        .addStringOption((option) =>
          option.setName('title').setDescription('Short title').setRequired(true),
        )
        .addStringOption((option) => option.setName('detail').setDescription('Details')),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lists recent suggestions.'))
    .addSubcommand((sub) =>
      sub
        .setName('decide')
        .setDescription('Approves or rejects a suggestion (staff only).')
        .addStringOption((option) =>
          option.setName('message_id').setDescription('Suggestion message ID').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('status')
            .setDescription('Decision')
            .addChoices(
              { name: 'approved', value: 'approved' },
              { name: 'rejected', value: 'rejected' },
              { name: 'implemented', value: 'implemented' },
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Sets the suggestion channel (staff only).')
        .addChannelOption((option) =>
          option.setName('channel').setDescription('Channel').setRequired(true),
        ),
    ),
  description: 'Suggestion system.',
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();
    const settings = await repos.guilds.getSettings(ctx.guild.id);
    const config = (settings.suggestions ?? {}) as { channelId?: string | null };

    if (sub === 'setup') {
      if (!ctx.member.permissions.has('ManageGuild')) throw new ValidationError('Staff only.');
      const channel = ctx.interaction.options.getChannel('channel', true);
      await repos.guilds.updateSettingsGroup(ctx.guild.id, 'suggestions', {
        channelId: channel.id,
      });
      await ctx.reply({
        embeds: [successEmbed(`Suggestions will be posted in <#${channel.id}>.`)],
      });
      return;
    }

    if (sub === 'create') {
      if (!config.channelId)
        throw new ValidationError(
          'No suggestion channel is configured. Ask staff to run `/suggest setup`.',
        );
      const channel = ctx.guild.channels.cache.get(config.channelId) as TextChannel | undefined;
      if (!channel)
        throw new ValidationError('The configured suggestion channel no longer exists.');
      const embed = new EmbedBuilder()
        .setTitle(ctx.interaction.options.getString('title', true))
        .setDescription(ctx.interaction.options.getString('detail') ?? '_No details provided._')
        .setFooter({ text: `Suggested by ${ctx.interaction.user.username}` })
        .setColor(0x5865f2)
        .setTimestamp();
      const message = await channel.send({ embeds: [embed] });
      await message.react('👍').catch(() => undefined);
      await message.react('👎').catch(() => undefined);
      await repos.community.createSuggestion({
        guildId: ctx.guild.id,
        channelId: channel.id,
        messageId: message.id,
        authorId: ctx.interaction.user.id,
        title: ctx.interaction.options.getString('title', true),
        detail: ctx.interaction.options.getString('detail') ?? '',
      });
      await ctx.reply({ content: `Suggestion posted: ${message.url}`, ephemeral: true });
      return;
    }

    if (sub === 'decide') {
      if (!ctx.member.permissions.has('ManageGuild')) throw new ValidationError('Staff only.');
      const ok = await repos.community.decideSuggestion(
        ctx.guild.id,
        ctx.interaction.options.getString('message_id', true),
        ctx.interaction.options.getString('status', true) as
          'approved' | 'rejected' | 'implemented',
        ctx.interaction.user.id,
      );
      await ctx.reply({
        embeds: [ok ? successEmbed('Suggestion updated.') : errorEmbed('No such suggestion.')],
      });
      return;
    }

    const rows = await repos.community.listSuggestions(ctx.guild.id, 15);
    await ctx.reply({
      embeds: [
        {
          title: `Suggestions (${rows.length})`,
          color: 0x5865f2,
          description:
            rows
              .map(
                (row) =>
                  `\`${row.status}\` **${row.title}** 👍${row.upvotes} 👎${row.downvotes} by <@${row.authorId}>`,
              )
              .join('\n')
              .slice(0, 4000) || '_none_',
        },
      ],
    });
  },
});

const poll = defineCommand({
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Creates and manages polls.')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Creates a poll.')
        .addStringOption((option) =>
          option.setName('question').setDescription('Question').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('options').setDescription('Comma separated options').setRequired(true),
        )
        .addBooleanOption((option) =>
          option.setName('multi').setDescription('Allow multiple votes'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('vote')
        .setDescription('Votes on the poll in this channel.')
        .addIntegerOption((option) =>
          option
            .setName('option')
            .setDescription('Option number (1-based)')
            .setMinValue(1)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('results').setDescription('Shows the current results.'))
    .addSubcommand((sub) => sub.setName('close').setDescription('Closes the poll.')),
  description: 'Creates and manages polls.',
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'create') {
      const options = ctx.interaction.options
        .getString('options', true)
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, 10);
      if (options.length < 2)
        throw new ValidationError('Provide at least two options, separated by commas.');
      const channel = ctx.interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText)
        throw new ValidationError('Use this in a text channel.');
      const question = ctx.interaction.options.getString('question', true);
      const embed = new EmbedBuilder()
        .setTitle(question)
        .setDescription(options.map((option, index) => `**${index + 1}.** ${option}`).join('\n'))
        .setFooter({ text: `Poll by ${ctx.interaction.user.username}` })
        .setColor(0x5865f2);
      const message = await channel.send({ embeds: [embed] });
      await repos.community.createPoll({
        guildId: ctx.guild.id,
        channelId: channel.id,
        messageId: message.id,
        question,
        options,
        multiVote: ctx.interaction.options.getBoolean('multi') ?? false,
        createdBy: ctx.interaction.user.id,
      });
      await ctx.reply({ content: `Poll created: ${message.url}`, ephemeral: true });
      return;
    }

    if (sub === 'vote') {
      const result = await repos.community.castVote({
        guildId: ctx.guild.id,
        messageId:
          ctx.interaction.channelId === ''
            ? ''
            : (ctx.interaction.options.getString('message_id') ?? ctx.interaction.channelId),
        userId: ctx.interaction.user.id,
        optionIndex: ctx.interaction.options.getInteger('option', true) - 1,
      });
      await ctx.reply({
        content: result.recorded
          ? 'Vote recorded.'
          : `Could not record that vote (${result.reason}).`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'results') {
      const results = await repos.community.pollResults(ctx.guild.id, ctx.interaction.channelId);
      if (!results) throw new ValidationError('No poll is running in this channel.');
      const total = results.reduce((sum, row) => sum + row.votes, 0);
      await ctx.reply({
        embeds: [
          {
            title: 'Poll results',
            color: 0x5865f2,
            description: results
              .map(
                (row, index) =>
                  `${index + 1}. ${row.option} - ${row.votes} vote(s) (${total ? Math.round((row.votes / total) * 100) : 0}%)`,
              )
              .join('\n'),
          },
        ],
      });
      return;
    }

    if (sub === 'close') {
      const ok = await repos.community.closePoll(ctx.guild.id, ctx.interaction.channelId);
      await ctx.reply({
        embeds: [ok ? successEmbed('Poll closed.') : errorEmbed('No poll in this channel.')],
      });
    }
  },
});

const reminder = defineCommand({
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Reminds you about something later.')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Creates a reminder.')
        .addStringOption((option) =>
          option.setName('in').setDescription('e.g. 30m, 2h, 1d').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('about').setDescription('What to be reminded about').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lists your pending reminders.'))
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancels a reminder by ID.')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('Reminder ID').setRequired(true),
        ),
    ),
  description: 'Reminds you about something later.',
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'create') {
      const ms = parseDuration(ctx.interaction.options.getString('in', true));
      if (ms === null)
        throw new ValidationError('Could not read that duration. Try `30m` or `2h`.');
      const id = await repos.community.createReminder({
        guildId: ctx.guild.id,
        channelId: ctx.interaction.channelId,
        userId: ctx.interaction.user.id,
        content: ctx.interaction.options.getString('about', true),
        remindAt: new Date(Date.now() + ms),
      });
      await ctx.reply({
        content: `Reminder #${id} set for ${discordTimestamp(new Date(Date.now() + ms), 'R')}.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'cancel') {
      const id = ctx.interaction.options.getInteger('id', true);
      const ok = await repos.community.markReminderSent(id);
      await ctx.reply({
        content: ok ? `Reminder #${id} cancelled.` : 'No such reminder.',
        ephemeral: true,
      });
      return;
    }

    const rows = await repos.community.dueReminders(new Date(Date.now() + 365 * 86_400_000), 50);
    const mine = rows.filter(
      (row) => row.userId === ctx.interaction.user.id && row.guildId === ctx.guild.id,
    );
    await ctx.reply({
      content:
        mine.length > 0
          ? mine.map((row) => `#${row.id} - ${row.content}`).join('\n')
          : 'No pending reminders.',
      ephemeral: true,
    });
  },
});

const birthday = defineCommand({
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Birthday announcements.')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Sets your birthday.')
        .addIntegerOption((option) =>
          option
            .setName('month')
            .setDescription('1-12')
            .setMinValue(1)
            .setMaxValue(12)
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('day')
            .setDescription('1-31')
            .setMinValue(1)
            .setMaxValue(31)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('upcoming').setDescription('Shows upcoming birthdays this month.'),
    ),
  description: 'Birthday announcements.',
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'set') {
      const month = ctx.interaction.options.getInteger('month', true);
      const day = ctx.interaction.options.getInteger('day', true);
      const daysInMonth = new Date(new Date().getFullYear(), month, 0).getDate();
      if (day > daysInMonth)
        throw new ValidationError(`Month ${month} only has ${daysInMonth} days.`);
      await repos.community.setBirthday(ctx.guild.id, ctx.interaction.user.id, month, day);
      await ctx.reply({ content: `Birthday saved: ${month}/${day}.`, ephemeral: true });
      return;
    }

    const now = new Date();
    const rows = await repos.community.birthdaysOn(now.getUTCMonth() + 1, now.getUTCDate());
    await ctx.reply({
      content:
        rows.length > 0
          ? `🎂 Today: ${rows.map((row) => `<@${row.userId}>`).join(', ')}`
          : 'No birthdays today.',
    });
  },
});

const reactionrole = defineCommand({
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Reaction-based role assignment.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Binds an emoji on a message to a role.')
        .addStringOption((option) =>
          option.setName('message_id').setDescription('Message ID').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('emoji').setDescription('Emoji').setRequired(true),
        )
        .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Removes a binding.')
        .addStringOption((option) =>
          option.setName('message_id').setDescription('Message ID').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('emoji').setDescription('Emoji').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lists bindings.')),
  description: 'Reaction-based role assignment.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_ROLES],
  clientPermissions: [PERMISSION_BIT.MANAGE_ROLES],
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'add') {
      const messageId = ctx.interaction.options.getString('message_id', true);
      const emoji = ctx.interaction.options.getString('emoji', true);
      const role = ctx.interaction.options.getRole('role', true);
      await repos.community.bindReactionRole({
        guildId: ctx.guild.id,
        channelId: ctx.interaction.channelId,
        messageId,
        emoji,
        roleId: role.id,
      });
      await ctx.reply({
        embeds: [successEmbed(`Bound ${emoji} on \`${messageId}\` to ${role}.`)],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'remove') {
      const ok = await repos.community.unbindReactionRole(
        ctx.guild.id,
        ctx.interaction.options.getString('message_id', true),
        ctx.interaction.options.getString('emoji', true),
      );
      await ctx.reply({
        embeds: [ok ? successEmbed('Binding removed.') : errorEmbed('No such binding.')],
        ephemeral: true,
      });
      return;
    }

    const rows = await repos.community.listReactionRoles(ctx.guild.id);
    await ctx.reply({
      embeds: [
        {
          title: `Reaction roles (${rows.length})`,
          color: 0x5865f2,
          description:
            rows
              .map(
                (row) =>
                  `${row.emoji} on \`${row.messageId}\` → <@&${row.roleId}> (\`${row.mode}\`)`,
              )
              .join('\n')
              .slice(0, 4000) || '_none_',
        },
      ],
      ephemeral: true,
    });
  },
});

const announce = defineCommand({
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Sends an announcement embed.')
    .addStringOption((option) =>
      option.setName('message').setDescription('Announcement text').setRequired(true),
    )
    .addChannelOption((option) =>
      option.setName('channel').setDescription('Channel (defaults to this one)'),
    ),
  description: 'Sends an announcement embed.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_MESSAGES],
  async execute(ctx) {
    const channel = ctx.interaction.options.getChannel('channel') ?? ctx.interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText)
      throw new ValidationError('Choose a text channel.');
    await (channel as TextChannel).send({
      embeds: [
        new EmbedBuilder()
          .setTitle('Announcement')
          .setDescription(ctx.interaction.options.getString('message', true))
          .setColor(0x5865f2)
          .setFooter({ text: ctx.interaction.user.username })
          .setTimestamp(),
      ],
    });
    await ctx.reply({ content: 'Announcement sent.', ephemeral: true });
  },
});

const embed = defineCommand({
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Builds a custom embed.')
    .addStringOption((option) => option.setName('title').setDescription('Title'))
    .addStringOption((option) =>
      option.setName('description').setDescription('Body').setRequired(true),
    )
    .addStringOption((option) => option.setName('color').setDescription('Hex colour, e.g. 5865f2')),
  description: 'Builds a custom embed.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_MESSAGES],
  async execute(ctx) {
    const color = ctx.interaction.options.getString('color');
    const parsed = color ? Number.parseInt(color.replace('#', ''), 16) : 0x5865f2;
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffffff) {
      throw new ValidationError('That is not a valid hex colour.');
    }
    const builder = new EmbedBuilder()
      .setDescription(ctx.interaction.options.getString('description', true))
      .setColor(parsed);
    const title = ctx.interaction.options.getString('title');
    if (title) builder.setTitle(title);
    await ctx.reply({ embeds: [builder] });
  },
});

const starboard = defineCommand({
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Configures the starboard.')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Sets the starboard channel and threshold.')
        .addChannelOption((option) =>
          option.setName('channel').setDescription('Channel').setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('stars').setDescription('Stars required').setMinValue(1).setMaxValue(50),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Shows the current configuration.'),
    ),
  description: 'Configures the starboard.',
  staffOnly: true,
  userPermissions: [PERMISSION_BIT.MANAGE_GUILD],
  async execute(ctx) {
    const repos = ctx.context.repos;
    if (!repos) throw new ValidationError('The database is not configured.');
    const sub = ctx.interaction.options.getSubcommand();
    const settings = await repos.guilds.getSettings(ctx.guild.id);
    const config = (settings.reaction_roles ?? {}) as Record<string, unknown>;
    const starConfig = (config.starboard ?? {}) as { channelId?: string; threshold?: number };

    if (sub === 'setup') {
      const channel = ctx.interaction.options.getChannel('channel', true);
      const threshold = ctx.interaction.options.getInteger('stars') ?? 3;
      await repos.guilds.updateSettingsGroup(ctx.guild.id, 'reaction_roles', {
        ...config,
        starboard: { channelId: channel.id, threshold },
      });
      await ctx.reply({
        embeds: [successEmbed(`Starboard set to <#${channel.id}> with ${threshold} star(s).`)],
      });
      return;
    }

    await ctx.reply({
      content: starConfig.channelId
        ? `Starboard: <#${starConfig.channelId}>, threshold ${starConfig.threshold ?? 3} star(s).`
        : 'Starboard is not configured. Use `/starboard setup`.',
      ephemeral: true,
    });
  },
});

export default [
  giveaway,
  suggest,
  poll,
  reminder,
  birthday,
  reactionrole,
  announce,
  embed,
  starboard,
];
