import type { Queryable } from '../client.js';
import {
  OwnerPolicy,
  ValidationError,
  customCommandSchema,
  findUnknownVariables,
  type CustomCommand,
} from '@dcbot/shared';

export interface CustomCommandInput {
  name: string;
  description: string;
  responseType: 'text' | 'embed';
  content?: string;
  embed?: Record<string, unknown>;
  ephemeral?: boolean;
  deleteInvocation?: boolean;
  enabled?: boolean;
}

/**
 * Custom command repository.
 *
 * Global commands are owner-only. The owner check is enforced here as well as
 * in the bot service layer, so a future code path cannot accidentally write a
 * global command without going through the OwnerPolicy.
 */
export class CustomCommandRepository {
  constructor(
    private readonly db: Queryable,
    private readonly owners: OwnerPolicy,
  ) {}

  // --- global (owner only) ---------------------------------------------------

  async createGlobal(input: CustomCommandInput, actorId: string): Promise<CustomCommand> {
    this.owners.requireOwner(actorId, 'create global custom commands');
    const data = validate(input);
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO custom_commands
         (scope, guild_id, name, description, response_type, content, embed, ephemeral, delete_invocation, enabled, created_by)
       VALUES ('global', NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.name,
        data.description,
        data.responseType,
        data.content ?? null,
        data.embed ? JSON.stringify(data.embed) : null,
        data.ephemeral ?? false,
        data.deleteInvocation ?? false,
        data.enabled ?? true,
        actorId,
      ],
    );
    return mapCommand(result.rows[0]!);
  }

  async updateGlobal(
    name: string,
    patch: Partial<CustomCommandInput>,
    actorId: string,
  ): Promise<CustomCommand> {
    this.owners.requireOwner(actorId, 'edit global custom commands');
    const current = await this.getGlobal(name);
    if (!current) throw new ValidationError(`Global command "${name}" does not exist.`);
    const merged = validate({
      name: current.name,
      description: patch.description ?? current.description,
      responseType: patch.responseType ?? current.responseType,
      content: patch.content ?? current.content ?? undefined,
      embed: patch.embed ?? current.embed ?? undefined,
      ephemeral: patch.ephemeral ?? current.ephemeral,
      deleteInvocation: patch.deleteInvocation ?? current.deleteInvocation,
      enabled: patch.enabled ?? current.enabled,
    });
    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE custom_commands
          SET description = $2, response_type = $3, content = $4, embed = $5,
              ephemeral = $6, delete_invocation = $7, enabled = $8,
              updated_by = $9, updated_at = now()
        WHERE scope = 'global' AND name = $1
        RETURNING *`,
      [
        merged.name,
        merged.description,
        merged.responseType,
        merged.content ?? null,
        merged.embed ? JSON.stringify(merged.embed) : null,
        merged.ephemeral ?? false,
        merged.deleteInvocation ?? false,
        merged.enabled ?? true,
        actorId,
      ],
    );
    return mapCommand(result.rows[0]!);
  }

  async deleteGlobal(name: string, actorId: string): Promise<boolean> {
    this.owners.requireOwner(actorId, 'delete global custom commands');
    const result = await this.db.query(
      `DELETE FROM custom_commands WHERE scope = 'global' AND name = $1`,
      [name],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async setGlobalEnabled(name: string, enabled: boolean, actorId: string): Promise<CustomCommand> {
    return this.updateGlobal(name, { enabled }, actorId);
  }

  async listGlobal(includeDisabled = true): Promise<CustomCommand[]> {
    const result = await this.db.query<Record<string, unknown>>(
      includeDisabled
        ? `SELECT * FROM custom_commands WHERE scope = 'global' ORDER BY name`
        : `SELECT * FROM custom_commands WHERE scope = 'global' AND enabled = TRUE ORDER BY name`,
    );
    return result.rows.map(mapCommand);
  }

  async getGlobal(name: string): Promise<CustomCommand | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM custom_commands WHERE scope = 'global' AND name = $1`,
      [name],
    );
    return result.rows[0] ? mapCommand(result.rows[0]) : null;
  }

  // --- guild scoped (server admins) -----------------------------------------

  async createGuild(
    guildId: string,
    input: CustomCommandInput,
    actorId: string,
  ): Promise<CustomCommand> {
    const data = validate(input);
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO custom_commands
         (scope, guild_id, name, description, response_type, content, embed, ephemeral, delete_invocation, enabled, created_by)
       VALUES ('guild', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        guildId,
        data.name,
        data.description,
        data.responseType,
        data.content ?? null,
        data.embed ? JSON.stringify(data.embed) : null,
        data.ephemeral ?? false,
        data.deleteInvocation ?? false,
        data.enabled ?? true,
        actorId,
      ],
    );
    return mapCommand(result.rows[0]!);
  }

  async deleteGuild(guildId: string, name: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM custom_commands WHERE scope = 'guild' AND guild_id = $1 AND name = $2`,
      [guildId, name],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listGuild(guildId: string): Promise<CustomCommand[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM custom_commands WHERE scope = 'guild' AND guild_id = $1 ORDER BY name`,
      [guildId],
    );
    return result.rows.map(mapCommand);
  }

  async getGuild(guildId: string, name: string): Promise<CustomCommand | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM custom_commands WHERE scope = 'guild' AND guild_id = $1 AND name = $2`,
      [guildId, name],
    );
    return result.rows[0] ? mapCommand(result.rows[0]) : null;
  }
}

function validate(input: CustomCommandInput) {
  const parsed = customCommandSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'command'}: ${issue.message}`)
        .join('; '),
    );
  }
  const text = parsed.data.content ?? '';
  const unknown = findUnknownVariables(text);
  if (unknown.length > 0) {
    throw new ValidationError(`Response uses unknown template variable(s): ${unknown.join(', ')}.`);
  }
  return parsed.data;
}

function mapCommand(row: Record<string, unknown>): CustomCommand {
  return {
    id: Number(row.id),
    scope: row.scope as CustomCommand['scope'],
    guildId: (row.guild_id as string | null) ?? null,
    name: String(row.name),
    description: String(row.description),
    responseType: row.response_type as 'text' | 'embed',
    content: (row.content as string | null) ?? null,
    embed: (row.embed as Record<string, unknown> | null) ?? null,
    ephemeral: Boolean(row.ephemeral),
    deleteInvocation: Boolean(row.delete_invocation),
    enabled: Boolean(row.enabled),
    createdBy: String(row.created_by),
    updatedBy: (row.updated_by as string | null) ?? null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}
