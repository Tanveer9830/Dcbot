import type { Queryable } from '../client.js';
import type { Ticket, TicketStatus } from '@dcbot/shared';

export class TicketRepository {
  constructor(private readonly db: Queryable) {}

  async create(params: {
    guildId: string;
    channelId: string;
    openerId: string;
    category?: string | null;
    reason?: string | null;
  }): Promise<Ticket> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO tickets (guild_id, channel_id, opener_id, category, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (guild_id, channel_id) DO UPDATE SET status = 'open', closed_at = NULL
       RETURNING *`,
      [params.guildId, params.channelId, params.openerId, params.category ?? null, params.reason ?? null],
    );
    return mapTicket(result.rows[0]!);
  }

  async getByChannel(guildId: string, channelId: string): Promise<Ticket | null> {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM tickets WHERE guild_id = $1 AND channel_id = $2',
      [guildId, channelId],
    );
    return result.rows[0] ? mapTicket(result.rows[0]) : null;
  }

  async getById(guildId: string, id: number): Promise<Ticket | null> {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM tickets WHERE guild_id = $1 AND id = $2',
      [guildId, id],
    );
    return result.rows[0] ? mapTicket(result.rows[0]) : null;
  }

  async list(guildId: string, status?: TicketStatus, limit = 25): Promise<Ticket[]> {
    const result = await this.db.query<Record<string, unknown>>(
      status
        ? 'SELECT * FROM tickets WHERE guild_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3'
        : 'SELECT * FROM tickets WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2',
      status ? [guildId, status, limit] : [guildId, limit],
    );
    return result.rows.map(mapTicket);
  }

  async countOpenByUser(guildId: string, userId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tickets
        WHERE guild_id = $1 AND opener_id = $2 AND status <> 'closed'`,
      [guildId, userId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async claim(guildId: string, channelId: string, staffId: string): Promise<Ticket | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE tickets SET status = 'claimed', claimed_by = $3
        WHERE guild_id = $1 AND channel_id = $2 AND status = 'open'
        RETURNING *`,
      [guildId, channelId, staffId],
    );
    return result.rows[0] ? mapTicket(result.rows[0]) : null;
  }

  async close(guildId: string, channelId: string): Promise<Ticket | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE tickets SET status = 'closed', closed_at = now()
        WHERE guild_id = $1 AND channel_id = $2 AND status <> 'closed'
        RETURNING *`,
      [guildId, channelId],
    );
    return result.rows[0] ? mapTicket(result.rows[0]) : null;
  }

  async reopen(guildId: string, channelId: string): Promise<Ticket | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE tickets SET status = 'open', closed_at = NULL
        WHERE guild_id = $1 AND channel_id = $2 AND status = 'closed'
        RETURNING *`,
      [guildId, channelId],
    );
    return result.rows[0] ? mapTicket(result.rows[0]) : null;
  }

  async rate(guildId: string, channelId: string, rating: number): Promise<boolean> {
    const clamped = Math.min(5, Math.max(1, Math.floor(rating)));
    const result = await this.db.query(
      'UPDATE tickets SET rating = $3 WHERE guild_id = $1 AND channel_id = $2',
      [guildId, channelId, clamped],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async appendMessage(params: {
    ticketId: number;
    authorId: string;
    authorIsBot?: boolean;
    content: string;
    attachmentCount?: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO ticket_messages (ticket_id, author_id, author_is_bot, content, attachment_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.ticketId,
        params.authorId,
        params.authorIsBot ?? false,
        params.content,
        params.attachmentCount ?? 0,
      ],
    );
  }

  /**
   * Transcript rows for a ticket. The caller MUST have verified the requester is
   * the opener, a claimed staff member, or a bot owner before calling this.
   */
  async transcript(ticketId: number): Promise<
    Array<{ authorId: string; authorIsBot: boolean; content: string; createdAt: Date }>
  > {
    const result = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at, id',
      [ticketId],
    );
    return result.rows.map((row) => ({
      authorId: String(row.author_id),
      authorIsBot: Boolean(row.author_is_bot),
      content: String(row.content),
      createdAt: new Date(String(row.created_at)),
    }));
  }
}

function mapTicket(row: Record<string, unknown>): Ticket {
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    channelId: String(row.channel_id),
    openerId: String(row.opener_id),
    claimedById: (row.claimed_by as string | null) ?? null,
    categoryId: (row.category as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    status: row.status as TicketStatus,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    createdAt: new Date(String(row.created_at)),
    closedAt: row.closed_at ? new Date(String(row.closed_at)) : null,
  };
}
