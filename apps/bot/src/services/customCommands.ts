import { EmbedBuilder } from 'discord.js';
import type { Repositories } from '../database/repositories.js';
import {
  OwnerPolicy,
  ValidationError,
  renderTemplate,
  type CustomCommand,
} from '@dcbot/shared';

export interface RenderedResponse {
  content?: string;
  embeds?: EmbedBuilder[];
  ephemeral: boolean;
  deleteInvocation: boolean;
}

/**
 * Custom command service.
 *
 * Two completely separate systems:
 *  1. GLOBAL commands - owner-only. The repository re-checks ownership, so a
 *     server Administrator can never create or edit one.
 *  2. GUILD commands - managed by that server's administrators.
 *
 * Responses are rendered with the allowlist template engine. There is no eval,
 * no shell, and no code execution path.
 */
export class CustomCommandService {
  constructor(
    private readonly repos: Repositories,
    private readonly owners: OwnerPolicy,
  ) {}

  // --- global (owner only) ---------------------------------------------------

  async createGlobal(params: {
    name: string;
    description: string;
    responseType: 'text' | 'embed';
    content?: string;
    embed?: Record<string, unknown>;
    ephemeral?: boolean;
    deleteInvocation?: boolean;
    actorId: string;
  }): Promise<CustomCommand> {
    const command = await this.repos.customCommands.createGlobal(params, params.actorId);
    await this.repos.audit.record({
      actorId: params.actorId,
      actorKind: 'bot_owner',
      action: 'globalcommand.create',
      targetType: 'custom_command',
      targetId: command.name,
      detail: { responseType: command.responseType, enabled: command.enabled },
    });
    return command;
  }

  async updateGlobal(name: string, patch: Record<string, unknown>, actorId: string): Promise<CustomCommand> {
    const command = await this.repos.customCommands.updateGlobal(
      name,
      patch as never,
      actorId,
    );
    await this.repos.audit.record({
      actorId,
      actorKind: 'bot_owner',
      action: 'globalcommand.edit',
      targetType: 'custom_command',
      targetId: name,
      detail: { changed: Object.keys(patch) },
    });
    return command;
  }

  async deleteGlobal(name: string, actorId: string): Promise<boolean> {
    const deleted = await this.repos.customCommands.deleteGlobal(name, actorId);
    await this.repos.audit.record({
      actorId,
      actorKind: 'bot_owner',
      action: 'globalcommand.delete',
      targetType: 'custom_command',
      targetId: name,
    });
    return deleted;
  }

  async publishGlobal(name: string, enabled: boolean, actorId: string): Promise<CustomCommand> {
    const command = await this.repos.customCommands.setGlobalEnabled(name, enabled, actorId);
    await this.repos.audit.record({
      actorId,
      actorKind: 'bot_owner',
      action: enabled ? 'globalcommand.publish' : 'globalcommand.disable',
      targetType: 'custom_command',
      targetId: name,
    });
    return command;
  }

  async listGlobal(): Promise<CustomCommand[]> {
    return this.repos.customCommands.listGlobal();
  }

  /** Owner-only preview: renders without publishing. */
  async previewGlobal(name: string, actorId: string, vars: Record<string, string> = {}): Promise<RenderedResponse> {
    this.owners.requireOwner(actorId, 'preview global custom commands');
    const command = await this.repos.customCommands.getGlobal(name);
    if (!command) throw new ValidationError(`Global command "${name}" does not exist.`);
    return this.render(command, vars);
  }

  // --- guild scoped ----------------------------------------------------------

  async createGuild(
    guildId: string,
    params: {
      name: string;
      description: string;
      responseType: 'text' | 'embed';
      content?: string;
      embed?: Record<string, unknown>;
      actorId: string;
    },
  ): Promise<CustomCommand> {
    const command = await this.repos.customCommands.createGuild(guildId, params, params.actorId);
    await this.repos.audit.record({
      guildId,
      actorId: params.actorId,
      action: 'guildcommand.create',
      targetType: 'custom_command',
      targetId: command.name,
    });
    return command;
  }

  async deleteGuild(guildId: string, name: string, actorId: string): Promise<boolean> {
    const deleted = await this.repos.customCommands.deleteGuild(guildId, name);
    await this.repos.audit.record({
      guildId,
      actorId,
      action: 'guildcommand.delete',
      targetType: 'custom_command',
      targetId: name,
    });
    return deleted;
  }

  async listGuild(guildId: string): Promise<CustomCommand[]> {
    return this.repos.customCommands.listGuild(guildId);
  }

  // --- resolution & rendering ------------------------------------------------

  /** Finds an enabled command by name: global first, then guild scoped. */
  async resolve(guildId: string, name: string): Promise<CustomCommand | null> {
    const global = await this.repos.customCommands.getGlobal(name);
    if (global?.enabled) return global;
    const guild = await this.repos.customCommands.getGuild(guildId, name);
    if (guild?.enabled) return guild;
    return null;
  }

  /** Renders a command into a Discord payload. */
  render(command: CustomCommand, vars: Record<string, string> = {}): RenderedResponse {
    if (command.responseType === 'text') {
      return {
        content: renderTemplate(command.content ?? '', vars, { strict: false, maxLength: 1900 }),
        ephemeral: command.ephemeral,
        deleteInvocation: command.deleteInvocation,
      };
    }
    const raw = (command.embed ?? {}) as {
      title?: string;
      description?: string;
      color?: number;
      footer?: string;
      fields?: Array<{ name: string; value: string; inline?: boolean }>;
    };
    const embed = new EmbedBuilder()
      .setColor(raw.color ?? 0x5865f2)
      .setTitle(raw.title ? renderTemplate(raw.title, vars, { strict: false, maxLength: 250 }) : null)
      .setDescription(
        raw.description ? renderTemplate(raw.description, vars, { strict: false, maxLength: 4000 }) : null,
      )
      .setFooter(raw.footer ? { text: renderTemplate(raw.footer, vars, { strict: false, maxLength: 2000 }) } : null);
    for (const field of raw.fields ?? []) {
      embed.addFields({
        name: renderTemplate(field.name, vars, { strict: false, maxLength: 250 }),
        value: renderTemplate(field.value, vars, { strict: false, maxLength: 1000 }),
        inline: field.inline ?? false,
      });
    }
    return { embeds: [embed], ephemeral: command.ephemeral, deleteInvocation: command.deleteInvocation };
  }
}
