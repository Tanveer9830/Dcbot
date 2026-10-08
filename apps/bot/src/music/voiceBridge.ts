import { GatewayDispatchEvents, GatewayOpcodes } from 'discord-api-types/v10';
import type { Client } from 'discord.js';
import type { VoiceBridge } from './manager.js';

interface VoiceServerPayload {
  token: string;
  guild_id: string;
  endpoint: string | null;
}

interface PendingVoice {
  sessionId?: string;
  token?: string;
  endpoint?: string | null;
  resolve: (value: { sessionId: string; endpoint: string; token: string }) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Discord voice signalling for Lavalink.
 *
 * The bot sends a Voice State Update (op 4) over the gateway, waits for both
 * VOICE_STATE_UPDATE (session id) and VOICE_SERVER_UPDATE (token + endpoint),
 * and hands the triple to Lavalink. Lavalink then joins the voice channel and
 * plays the audio, so no native audio bindings are needed in this process.
 */
export class DiscordVoiceBridge implements VoiceBridge {
  private readonly pending = new Map<string, PendingVoice>();

  constructor(
    private readonly client: Client,
    public readonly selfDeaf = true,
  ) {
    this.client.on('raw', (packet) => this.handleRaw(packet as Record<string, unknown>));
  }

  join(guildId: string, channelId: string): void {
    this.send(guildId, {
      op: GatewayOpcodes.VoiceStateUpdate,
      d: { guild_id: guildId, channel_id: channelId, self_deaf: this.selfDeaf, self_mute: false },
    });
  }

  leave(guildId: string): void {
    this.send(guildId, {
      op: GatewayOpcodes.VoiceStateUpdate,
      d: { guild_id: guildId, channel_id: null, self_deaf: true, self_mute: true },
    });
    const pending = this.pending.get(guildId);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(guildId);
  }

  /** Sends a gateway payload on the shard that owns this guild. */
  private send(guildId: string, payload: { op: number; d: Record<string, unknown> }): void {
    const shard = this.client.guilds.cache.get(guildId)?.shard;
    if (!shard) return;
    shard.send(payload as never);
  }

  waitForVoiceState(
    guildId: string,
    timeoutMs = 15_000,
  ): Promise<{ sessionId: string; endpoint: string; token: string }> {
    return new Promise((resolve, reject) => {
      const existing = this.pending.get(guildId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.reject(new Error('Superseded by a newer voice request.'));
      }
      const timer = setTimeout(() => {
        this.pending.delete(guildId);
        reject(new Error('Timed out waiting for Discord voice state.'));
      }, timeoutMs);
      this.pending.set(guildId, { resolve, reject, timer });
    });
  }

  private handleRaw(packet: Record<string, unknown>): void {
    const type = packet.t as string | undefined;
    const data = packet.d as Record<string, unknown> | undefined;
    if (!type || !data) return;

    if (type === GatewayDispatchEvents.VoiceStateUpdate) {
      const guildId = data.guild_id as string | undefined;
      if (!guildId) return;
      const pending = this.pending.get(guildId);
      if (pending) pending.sessionId = data.session_id as string;
      this.settle(guildId);
      return;
    }

    if (type === GatewayDispatchEvents.VoiceServerUpdate) {
      const payload = data as unknown as VoiceServerPayload;
      const pending = this.pending.get(payload.guild_id);
      if (pending) {
        pending.token = payload.token;
        pending.endpoint = payload.endpoint;
      }
      this.settle(payload.guild_id);
    }
  }

  private settle(guildId: string): void {
    const pending = this.pending.get(guildId);
    if (!pending || !pending.sessionId || !pending.token || !pending.endpoint) return;
    clearTimeout(pending.timer);
    this.pending.delete(guildId);
    pending.resolve({ sessionId: pending.sessionId, token: pending.token, endpoint: pending.endpoint });
  }
}
