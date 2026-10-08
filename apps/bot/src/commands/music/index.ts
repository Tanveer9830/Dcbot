import { ChannelType, SlashCommandBuilder } from 'discord.js';
import {
  defineCommand,
  requireService,
  successEmbed,
  errorEmbed,
  ValidationError,
} from '../helpers.js';
import type { CommandExecutionContext } from '../../types.js';
import { formatDuration, parseDuration } from '../../utils/format.js';
import { PERMISSION_BIT } from '@dcbot/shared';

/** Resolves the member's current voice channel or throws. */
function voiceChannelId(ctx: CommandExecutionContext): string {
  const channel = ctx.member.voice.channel;
  if (!channel) throw new ValidationError('Join a voice channel first.');
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    throw new ValidationError('That is not a voice channel.');
  }
  return channel.id;
}

const music = defineCommand({
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music playback (requires a configured Lavalink node).')
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('Plays a URL or searches by name.')
        .addStringOption((option) =>
          option
            .setName('query')
            .setDescription('YouTube URL, Spotify link, or search text')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('pause').setDescription('Pauses playback.'))
    .addSubcommand((sub) => sub.setName('resume').setDescription('Resumes playback.'))
    .addSubcommand((sub) => sub.setName('skip').setDescription('Skips the current track.'))
    .addSubcommand((sub) =>
      sub.setName('previous').setDescription('Goes back to the previous track.'),
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stops playback and clears the queue.'),
    )
    .addSubcommand((sub) => sub.setName('queue').setDescription('Shows the upcoming queue.'))
    .addSubcommand((sub) => sub.setName('nowplaying').setDescription('Shows the current track.'))
    .addSubcommand((sub) =>
      sub
        .setName('volume')
        .setDescription('Sets the player volume.')
        .addIntegerOption((option) =>
          option
            .setName('percent')
            .setDescription('0-150')
            .setMinValue(0)
            .setMaxValue(150)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('seek')
        .setDescription('Seeks to a position.')
        .addStringOption((option) =>
          option.setName('position').setDescription('e.g. 1m30s').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('loop')
        .setDescription('Sets the loop mode.')
        .addStringOption((option) =>
          option
            .setName('mode')
            .setDescription('Mode')
            .addChoices(
              { name: 'off', value: 'off' },
              { name: 'track', value: 'track' },
              { name: 'queue', value: 'queue' },
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('shuffle').setDescription('Shuffles the queue.'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Removes a track from the queue.')
        .addIntegerOption((option) =>
          option
            .setName('index')
            .setDescription('Queue position (1-based)')
            .setMinValue(1)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('clear').setDescription('Clears the upcoming queue.'))
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Shows the music backend health.'),
    ),
  description: 'Music playback.',
  clientPermissions: [PERMISSION_BIT.CONNECT, PERMISSION_BIT.SPEAK],
  cooldownMs: 2000,
  async execute(ctx) {
    const manager = requireService(ctx.context.services.music, 'music');
    if (!manager.isAvailable) {
      await ctx.reply({
        embeds: [
          errorEmbed(
            'Music is not configured on this instance. Set LAVALINK_HOST and LAVALINK_PASSWORD, then restart the bot (see docs/DEPLOYMENT.md).',
          ),
        ],
      });
      return;
    }
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'status') {
      const health = await manager.health();
      await ctx.reply({
        embeds: [
          {
            title: 'Music backend',
            color: health.status === 'ok' ? 0x57f287 : 0xfaa61a,
            fields: [
              { name: 'Status', value: health.status, inline: true },
              {
                name: 'Latency',
                value:
                  health.latencyMs !== undefined && health.latencyMs !== null
                    ? `${health.latencyMs} ms`
                    : 'n/a',
                inline: true,
              },
              {
                name: 'Spotify metadata',
                value: manager.spotifyConfigured ? 'configured' : 'not configured',
                inline: true,
              },
              { name: 'Detail', value: health.detail ?? 'none' },
            ],
          },
        ],
      });
      return;
    }

    const guildId = ctx.guild.id;
    const voiceChannelIdValue = voiceChannelId(ctx);
    const player = manager.getPlayer(guildId);

    if (sub === 'play') {
      const query = ctx.interaction.options.getString('query', true);
      const result = await manager.enqueue({
        guildId,
        voiceChannelId: voiceChannelIdValue,
        textChannelId: ctx.interaction.channelId,
        query,
        requestedBy: ctx.interaction.user.id,
      });
      if (result.added === 0) {
        await ctx.reply({
          embeds: [errorEmbed(result.note ?? 'Nothing could be loaded from that query.')],
        });
        return;
      }
      const current = manager.getPlayer(guildId)?.queue.getCurrent();
      await ctx.reply({
        embeds: [
          successEmbed(
            `Added ${result.added} track(s).${current ? ` Now playing: **${current.track.info.title}**` : ''}${result.note ? `\n_${result.note}_` : ''}`,
          ),
        ],
      });
      return;
    }

    if (!player) throw new ValidationError('Nothing is playing in this server.');

    switch (sub) {
      case 'pause':
        await manager.pause(guildId, true);
        await ctx.reply({ content: '⏸️ Paused.' });
        break;
      case 'resume':
        await manager.pause(guildId, false);
        await ctx.reply({ content: '▶️ Resumed.' });
        break;
      case 'skip': {
        const next = await manager.skip(guildId);
        await ctx.reply({
          content: next ? `⏭️ Now playing: **${next.track.info.title}**` : '⏭️ Queue finished.',
        });
        break;
      }
      case 'previous': {
        const prior = await manager.previous(guildId);
        await ctx.reply({
          content: prior ? `⏮️ Playing: **${prior.track.info.title}**` : 'No previous track.',
        });
        break;
      }
      case 'stop':
        await manager.stop(guildId, { destroy: true });
        await ctx.reply({ content: '⏹️ Stopped and cleared.' });
        break;
      case 'queue': {
        const snapshot = player.queue.snapshot();
        const lines = snapshot.upcoming
          .slice(0, 10)
          .map((item, index) => `${index + 1}. ${item.track.info.title} - <@${item.requestedBy}>`);
        await ctx.reply({
          embeds: [
            {
              title: `Queue (${snapshot.length} upcoming)`,
              color: 0x5865f2,
              description: [
                snapshot.current
                  ? `**Now:** ${snapshot.current.track.info.title}`
                  : '_Nothing playing_',
                ...lines,
                `Loop: ${snapshot.loop} | Total: ${formatDuration(snapshot.totalDurationMs)}`,
              ]
                .join('\n')
                .slice(0, 4000),
            },
          ],
        });
        break;
      }
      case 'nowplaying': {
        const current = player.queue.getCurrent();
        if (!current) {
          await ctx.reply({ content: 'Nothing is playing.' });
          break;
        }
        await ctx.reply({
          embeds: [
            {
              title: 'Now playing',
              color: 0x5865f2,
              description: `**${current.track.info.title}** by ${current.track.info.author}`,
              fields: [
                { name: 'Requested by', value: `<@${current.requestedBy}>`, inline: true },
                {
                  name: 'Length',
                  value: current.track.info.isStream
                    ? 'stream'
                    : formatDuration(current.track.info.length),
                  inline: true,
                },
                { name: 'Loop', value: player.queue.getLoop(), inline: true },
              ],
            },
          ],
        });
        break;
      }
      case 'volume': {
        const volume = await manager.setVolume(
          guildId,
          ctx.interaction.options.getInteger('percent', true),
        );
        await ctx.reply({ content: `🔊 Volume set to ${volume}%.` });
        break;
      }
      case 'seek': {
        const ms = parseDuration(ctx.interaction.options.getString('position', true));
        if (ms === null) throw new ValidationError('Could not read that position. Try `1m30s`.');
        const position = await manager.seek(guildId, ms);
        await ctx.reply({ content: `Seeked to ${formatDuration(position)}.` });
        break;
      }
      case 'loop': {
        const mode = ctx.interaction.options.getString('mode', true) as 'off' | 'track' | 'queue';
        const applied = manager.setLoop(guildId, mode);
        await ctx.reply({ content: `🔁 Loop mode: ${applied}.` });
        break;
      }
      case 'shuffle': {
        const count = manager.shuffle(guildId);
        await ctx.reply({ content: `🔀 Shuffled ${count} track(s).` });
        break;
      }
      case 'remove': {
        const index = ctx.interaction.options.getInteger('index', true) - 1;
        const removed = manager.remove(guildId, index);
        await ctx.reply({
          content: removed
            ? `Removed **${removed.track.info.title}**.`
            : 'No track at that position.',
        });
        break;
      }
      case 'clear': {
        const count = manager.clear(guildId);
        await ctx.reply({ content: `Cleared ${count} upcoming track(s).` });
        break;
      }
      default:
        await ctx.reply({ content: 'Unknown music subcommand.', ephemeral: true });
    }
  },
});

export default [music];
