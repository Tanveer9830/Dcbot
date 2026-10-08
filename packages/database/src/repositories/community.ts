import type { Queryable } from '../client.js';
import type { Giveaway } from '@dcbot/shared';

/** Giveaways, suggestions, polls, reaction roles, starboard, birthdays, reminders. */
export class CommunityRepository {
  constructor(private readonly db: Queryable) {}

  // --- giveaways -------------------------------------------------------------

  async createGiveaway(params: {
    guildId: string;
    channelId: string;
    messageId: string;
    hostId: string;
    prize: string;
    winnerCount: number;
    endsAt: Date;
  }): Promise<Giveaway> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO giveaways (guild_id, channel_id, message_id, host_id, prize, winner_count, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        params.guildId,
        params.channelId,
        params.messageId,
        params.hostId,
        params.prize,
        params.winnerCount,
        params.endsAt,
      ],
    );
    return mapGiveaway(result.rows[0]!);
  }

  async enter(giveawayId: number, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [giveawayId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async leave(giveawayId: number, userId: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM giveaway_entries WHERE giveaway_id = $1 AND user_id = $2',
      [giveawayId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async entrants(giveawayId: number): Promise<string[]> {
    const result = await this.db.query<{ user_id: string }>(
      'SELECT user_id FROM giveaway_entries WHERE giveaway_id = $1 ORDER BY user_id',
      [giveawayId],
    );
    return result.rows.map((row) => row.user_id);
  }

  async dueGiveaways(now = new Date()): Promise<Giveaway[]> {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM giveaways WHERE ended = FALSE AND ends_at <= $1 ORDER BY ends_at',
      [now],
    );
    return result.rows.map(mapGiveaway);
  }

  /**
   * Picks winners deterministically from the supplied entrant list using an
   * injected RNG so the draw is testable. Marks the giveaway ended atomically.
   */
  async finishGiveaway(
    giveawayId: number,
    entrants: string[],
    winnerCount: number,
    random: () => number = Math.random,
  ): Promise<{ winners: string[]; marked: boolean }> {
    const pool = [...entrants];
    // Fisher-Yates shuffle driven by the injected RNG.
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
    }
    const winners = pool.slice(0, Math.max(0, winnerCount));
    const result = await this.db.query(
      `UPDATE giveaways SET ended = TRUE, winner_ids = $2::text[]
        WHERE id = $1 AND ended = FALSE`,
      [giveawayId, winners],
    );
    return { winners, marked: (result.rowCount ?? 0) > 0 };
  }

  async activeGiveaways(guildId: string): Promise<Giveaway[]> {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM giveaways WHERE guild_id = $1 AND ended = FALSE ORDER BY ends_at',
      [guildId],
    );
    return result.rows.map(mapGiveaway);
  }

  // --- suggestions -----------------------------------------------------------

  async createSuggestion(params: {
    guildId: string;
    channelId: string;
    messageId: string;
    authorId: string;
    title: string;
    detail?: string;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO suggestions (guild_id, channel_id, message_id, author_id, title, detail)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        params.guildId,
        params.channelId,
        params.messageId,
        params.authorId,
        params.title,
        params.detail ?? '',
      ],
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  async vote(guildId: string, messageId: string, delta: 1 | -1, positive: boolean): Promise<void> {
    await this.db.query(
      `UPDATE suggestions SET ${positive ? 'upvotes' : 'downvotes'} = GREATEST(0, ${positive ? 'upvotes' : 'downvotes'} + $3::int)
        WHERE guild_id = $1 AND message_id = $2`,
      [guildId, messageId, delta],
    );
  }

  async decideSuggestion(
    guildId: string,
    messageId: string,
    status: 'approved' | 'rejected' | 'implemented',
    decidedBy: string,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE suggestions SET status = $3, decided_by = $4 WHERE guild_id = $1 AND message_id = $2`,
      [guildId, messageId, status, decidedBy],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listSuggestions(
    guildId: string,
    limit = 25,
  ): Promise<
    Array<{
      id: number;
      title: string;
      status: string;
      upvotes: number;
      downvotes: number;
      authorId: string;
      messageId: string;
    }>
  > {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM suggestions WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2',
      [guildId, limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      title: String(row.title),
      status: String(row.status),
      upvotes: Number(row.upvotes),
      downvotes: Number(row.downvotes),
      authorId: String(row.author_id),
      messageId: String(row.message_id),
    }));
  }

  // --- polls -----------------------------------------------------------------

  async createPoll(params: {
    guildId: string;
    channelId: string;
    messageId: string;
    question: string;
    options: string[];
    multiVote?: boolean;
    endsAt?: Date | null;
    createdBy: string;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO polls (guild_id, channel_id, message_id, question, options, multi_vote, ends_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        params.guildId,
        params.channelId,
        params.messageId,
        params.question,
        params.options,
        params.multiVote ?? false,
        params.endsAt ?? null,
        params.createdBy,
      ],
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  async castVote(params: {
    guildId: string;
    messageId: string;
    userId: string;
    optionIndex: number;
  }): Promise<{ recorded: boolean; reason?: 'closed' | 'single_vote' | 'invalid_option' }> {
    const poll = await this.db.queryOne<{
      id: number;
      closed: boolean;
      multi_vote: boolean;
      options: string[];
    }>(
      'SELECT id, closed, multi_vote, options FROM polls WHERE guild_id = $1 AND message_id = $2',
      [params.guildId, params.messageId],
    );
    if (!poll) return { recorded: false, reason: 'invalid_option' };
    if (poll.closed) return { recorded: false, reason: 'closed' };
    if (params.optionIndex < 0 || params.optionIndex >= poll.options.length) {
      return { recorded: false, reason: 'invalid_option' };
    }
    if (!poll.multi_vote) {
      await this.db.query('DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [
        poll.id,
        params.userId,
      ]);
    }
    await this.db.query(
      `INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [poll.id, params.userId, params.optionIndex],
    );
    return { recorded: true };
  }

  async pollResults(
    guildId: string,
    messageId: string,
  ): Promise<Array<{ option: string; votes: number }> | null> {
    const poll = await this.db.queryOne<{ id: number; options: string[] }>(
      'SELECT id, options FROM polls WHERE guild_id = $1 AND message_id = $2',
      [guildId, messageId],
    );
    if (!poll) return null;
    const counts = await this.db.query<{ option_index: number; votes: string }>(
      'SELECT option_index, COUNT(*)::text AS votes FROM poll_votes WHERE poll_id = $1 GROUP BY option_index',
      [poll.id],
    );
    const map = new Map(counts.rows.map((row) => [Number(row.option_index), Number(row.votes)]));
    return poll.options.map((option, index) => ({ option, votes: map.get(index) ?? 0 }));
  }

  async closePoll(guildId: string, messageId: string): Promise<boolean> {
    const result = await this.db.query(
      'UPDATE polls SET closed = TRUE WHERE guild_id = $1 AND message_id = $2',
      [guildId, messageId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // --- reaction roles --------------------------------------------------------

  async bindReactionRole(params: {
    guildId: string;
    channelId: string;
    messageId: string;
    emoji: string;
    roleId: string;
    mode?: 'toggle' | 'bind' | 'unbind' | 'verify';
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id, mode)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (guild_id, message_id, emoji) DO UPDATE SET role_id = EXCLUDED.role_id, mode = EXCLUDED.mode`,
      [
        params.guildId,
        params.channelId,
        params.messageId,
        params.emoji,
        params.roleId,
        params.mode ?? 'toggle',
      ],
    );
  }

  async unbindReactionRole(guildId: string, messageId: string, emoji: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM reaction_roles WHERE guild_id = $1 AND message_id = $2 AND emoji = $3',
      [guildId, messageId, emoji],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async reactionRoleFor(
    guildId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ roleId: string; mode: string } | null> {
    const row = await this.db.queryOne<{ role_id: string; mode: string }>(
      'SELECT role_id, mode FROM reaction_roles WHERE guild_id = $1 AND message_id = $2 AND emoji = $3',
      [guildId, messageId, emoji],
    );
    return row ? { roleId: row.role_id, mode: row.mode } : null;
  }

  async listReactionRoles(
    guildId: string,
  ): Promise<
    Array<{ channelId: string; messageId: string; emoji: string; roleId: string; mode: string }>
  > {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM reaction_roles WHERE guild_id = $1 ORDER BY created_at DESC',
      [guildId],
    );
    return result.rows.map((row) => ({
      channelId: String(row.channel_id),
      messageId: String(row.message_id),
      emoji: String(row.emoji),
      roleId: String(row.role_id),
      mode: String(row.mode),
    }));
  }

  // --- starboard -------------------------------------------------------------

  async upsertStarboardEntry(params: {
    guildId: string;
    messageId: string;
    channelId: string;
    authorId: string;
    stars: number;
    starboardMessageId?: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO starboard_entries (guild_id, message_id, channel_id, author_id, stars, starboard_message_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (guild_id, message_id) DO UPDATE SET
         stars = EXCLUDED.stars,
         starboard_message_id = COALESCE(EXCLUDED.starboard_message_id, starboard_entries.starboard_message_id)`,
      [
        params.guildId,
        params.messageId,
        params.channelId,
        params.authorId,
        params.stars,
        params.starboardMessageId ?? null,
      ],
    );
  }

  // --- birthdays & reminders -------------------------------------------------

  async setBirthday(guildId: string, userId: string, month: number, day: number): Promise<void> {
    await this.db.query(
      `INSERT INTO birthdays (guild_id, user_id, month, day) VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET month = EXCLUDED.month, day = EXCLUDED.day`,
      [guildId, userId, month, day],
    );
  }

  async birthdaysOn(
    month: number,
    day: number,
  ): Promise<Array<{ guildId: string; userId: string }>> {
    const result = await this.db.query<{ guild_id: string; user_id: string }>(
      'SELECT guild_id, user_id FROM birthdays WHERE month = $1 AND day = $2',
      [month, day],
    );
    return result.rows.map((row) => ({ guildId: row.guild_id, userId: row.user_id }));
  }

  async createReminder(params: {
    guildId: string;
    channelId: string;
    userId: string;
    content: string;
    remindAt: Date;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO reminders (guild_id, channel_id, user_id, content, remind_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [params.guildId, params.channelId, params.userId, params.content, params.remindAt],
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  async dueReminders(
    now = new Date(),
    limit = 50,
  ): Promise<
    Array<{ id: number; guildId: string; channelId: string; userId: string; content: string }>
  > {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM reminders WHERE sent_at IS NULL AND remind_at <= $1 ORDER BY remind_at LIMIT $2',
      [now, limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      guildId: String(row.guild_id),
      channelId: String(row.channel_id),
      userId: String(row.user_id),
      content: String(row.content),
    }));
  }

  async markReminderSent(id: number): Promise<boolean> {
    const result = await this.db.query('UPDATE reminders SET sent_at = now() WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}

function mapGiveaway(row: Record<string, unknown>): Giveaway {
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    channelId: String(row.channel_id),
    messageId: String(row.message_id),
    hostId: String(row.host_id),
    prize: String(row.prize),
    winnerCount: Number(row.winner_count),
    endsAt: new Date(String(row.ends_at)),
    ended: Boolean(row.ended),
    createdAt: new Date(String(row.created_at)),
  };
}
