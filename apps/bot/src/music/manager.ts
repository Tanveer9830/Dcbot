import type { HealthSnapshot, ServiceUnavailableError } from '@dcbot/shared';
import { ValidationError } from '@dcbot/shared';
import type { Logger } from '../utils/logger.js';
import { LavalinkClient } from './lavalinkClient.js';
import { SpotifyMetadataClient, isSpotifyUrl, parseSpotifyUrl } from './spotify.js';
import { TrackQueue } from './queue.js';
import type { LavalinkTrack, LoopMode, QueuedTrack } from './types.js';

/** Discord voice signalling, isolated so the manager stays testable. */
export interface VoiceBridge {
  join(guildId: string, channelId: string): void;
  leave(guildId: string): void;
  /** Resolves once Discord has sent both the voice state and the server update. */
  waitForVoiceState(
    guildId: string,
    timeoutMs?: number,
  ): Promise<{ sessionId: string; endpoint: string; token: string }>;
  selfDeaf: boolean;
}

export interface GuildPlayer {
  guildId: string;
  textChannelId: string;
  voiceChannelId: string;
  queue: TrackQueue;
  volume: number;
  paused: boolean;
  connectedAt: number;
}

export interface MusicConfig {
  djRoleIds: string[];
  defaultVolume: number;
  maxVolume: number;
  voteSkipEnabled: boolean;
  idleDisconnectMinutes: number;
  announcementChannelId: string | null;
}

export const DEFAULT_MUSIC: MusicConfig = {
  djRoleIds: [],
  defaultVolume: 80,
  maxVolume: 150,
  voteSkipEnabled: false,
  idleDisconnectMinutes: 5,
  announcementChannelId: null,
};

export class MusicManager {
  private readonly players = new Map<string, GuildPlayer>();
  private readonly lavalink: LavalinkClient | null;
  private readonly spotify: SpotifyMetadataClient;

  constructor(params: {
    host?: string;
    port: number;
    password?: string;
    secure?: boolean;
    userId: string;
    spotifyClientId?: string;
    spotifyClientSecret?: string;
    voice: VoiceBridge;
    logger: Logger;
    fetchImpl?: typeof fetch;
  }) {
    this.spotify = new SpotifyMetadataClient(params.spotifyClientId, params.spotifyClientSecret, params.fetchImpl);
    this.logger = params.logger;
    this.voice = params.voice;
    if (params.host && params.password) {
      this.lavalink = new LavalinkClient(
        {
          host: params.host,
          port: params.port,
          password: params.password,
          secure: params.secure ?? false,
          userId: params.userId,
        },
        params.logger,
        params.fetchImpl,
      );
      this.lavalink.connect();
      this.lavalink.on((event) => this.handleNodeEvent(event));
    } else {
      this.lavalink = null;
      params.logger.warn('music: LAVALINK_HOST/PASSWORD not set - playback disabled');
    }
  }

  private readonly logger: Logger;
  private readonly voice: VoiceBridge;

  get isAvailable(): boolean {
    return this.lavalink !== null;
  }

  get spotifyConfigured(): boolean {
    return this.spotify.isConfigured;
  }

  private requireNode(): LavalinkClient {
    if (!this.lavalink) {
      throw new ValidationError(
        'The music backend is not configured. Set LAVALINK_HOST and LAVALINK_PASSWORD (see docs/DEPLOYMENT.md).',
      );
    }
    if (!this.lavalink.isConnected) {
      throw new ValidationError('The music node is not connected yet. Try again in a few seconds.');
    }
    return this.lavalink;
  }

  async health(): Promise<HealthSnapshot> {
    if (!this.lavalink) {
      return {
        service: 'lavalink',
        status: 'unknown',
        detail: 'not configured',
        checkedAt: new Date().toISOString(),
      };
    }
    const probe = await this.lavalink.probe();
    return {
      service: 'lavalink',
      status: probe.ok && this.lavalink.isConnected ? 'ok' : 'degraded',
      latencyMs: probe.latencyMs,
      detail: probe.ok ? (this.lavalink.isConnected ? 'websocket + REST reachable' : 'REST reachable, websocket down') : probe.detail,
      checkedAt: new Date().toISOString(),
    };
  }

  /** Resolves a user query (URL or search text) into Lavalink tracks. */
  async resolve(query: string): Promise<{ tracks: LavalinkTrack[]; note: string | null }> {
    const node = this.requireNode();
    if (isSpotifyUrl(query)) {
      const link = parseSpotifyUrl(query);
      if (!link) throw new ValidationError('That Spotify link could not be parsed.');
      if (!this.spotify.isConfigured) {
        return {
          tracks: [],
          note:
            'Spotify links need SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET. ' +
            'This bot resolves Spotify metadata and plays it from a permitted source; it cannot stream Spotify audio directly.',
        };
      }
      const resolved = await this.spotify.resolve(link);
      if (resolved.queries.length === 0) {
        return { tracks: [], note: 'That Spotify link could not be resolved into playable tracks.' };
      }
      const tracks: LavalinkTrack[] = [];
      for (const search of resolved.queries) {
        const result = await node.loadTracks(`ytsearch:${search}`);
        const first = Array.isArray(result.data) ? result.data[0] : result.loadType === 'track' ? (result.data as LavalinkTrack) : null;
        if (first) tracks.push(first);
      }
      return {
        tracks,
        note:
          tracks.length > 0
            ? `Resolved ${tracks.length} Spotify ${link.kind === 'track' ? 'track' : 'tracks'} via metadata search.`
            : 'No matches found on the configured playback source.',
      };
    }

    const identifier = /^https?:\/\//i.test(query) ? query : `ytsearch:${query}`;
    const result = await node.loadTracks(identifier);
    if (result.loadType === 'error') {
      const error = result.data as { message?: string };
      throw new ValidationError(`Could not load that track: ${error?.message ?? 'unknown error'}`);
    }
    if (result.loadType === 'empty' || !result.data) return { tracks: [], note: 'No results found.' };
    const tracks = Array.isArray(result.data) ? result.data : [result.data as LavalinkTrack];
    return { tracks, note: null };
  }

  /** Ensures a player exists and is connected to the given voice channel. */
  async connect(params: { guildId: string; voiceChannelId: string; textChannelId: string }): Promise<GuildPlayer> {
    const node = this.requireNode();
    let player = this.players.get(params.guildId);
    if (player && player.voiceChannelId === params.voiceChannelId) {
      player.textChannelId = params.textChannelId;
      return player;
    }
    this.voice.join(params.guildId, params.voiceChannelId);
    const voiceState = await this.voice.waitForVoiceState(params.guildId, 15_000);
    await node.updatePlayer({ guildId: params.guildId, voice: voiceState });
    player = {
      guildId: params.guildId,
      textChannelId: params.textChannelId,
      voiceChannelId: params.voiceChannelId,
      queue: new TrackQueue(),
      volume: DEFAULT_MUSIC.defaultVolume,
      paused: false,
      connectedAt: Date.now(),
    };
    this.players.set(params.guildId, player);
    return player;
  }

  async enqueue(params: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    query: string;
    requestedBy: string;
  }): Promise<{ added: number; nowPlaying: QueuedTrack | null; note: string | null }> {
    const player = await this.connect(params);
    const { tracks, note } = await this.resolve(params.query);
    if (tracks.length === 0) return { added: 0, nowPlaying: player.queue.getCurrent(), note };
    const wasEmpty = player.queue.isEmpty;
    const added = player.queue.addMany(tracks, params.requestedBy);
    if (wasEmpty) await this.startNext(player);
    return { added, nowPlaying: player.queue.getCurrent(), note };
  }

  private async startNext(player: GuildPlayer): Promise<QueuedTrack | null> {
    const node = this.requireNode();
    const next = player.queue.next();
    if (!next) {
      await this.stop(player.guildId, { destroy: false });
      return null;
    }
    await node.updatePlayer({ guildId: player.guildId, encodedTrack: next.track.encoded, paused: false });
    player.paused = false;
    return next;
  }

  async pause(guildId: string, paused: boolean): Promise<boolean> {
    const node = this.requireNode();
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    await node.updatePlayer({ guildId, paused });
    player.paused = paused;
    return true;
  }

  async skip(guildId: string): Promise<QueuedTrack | null> {
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    player.queue.skip();
    return this.startNext(player);
  }

  async previous(guildId: string): Promise<QueuedTrack | null> {
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    const prior = player.queue.previous();
    if (!prior) return null;
    const node = this.requireNode();
    await node.updatePlayer({ guildId, encodedTrack: prior.track.encoded, position: 0, paused: false });
    return prior;
  }

  async setVolume(guildId: string, volume: number, maxVolume = DEFAULT_MUSIC.maxVolume): Promise<number> {
    const node = this.requireNode();
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    const clamped = Math.max(0, Math.min(maxVolume, Math.floor(volume)));
    await node.updatePlayer({ guildId, volume: clamped });
    player.volume = clamped;
    return clamped;
  }

  async seek(guildId: string, positionMs: number): Promise<number> {
    const node = this.requireNode();
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    const current = player.queue.getCurrent();
    if (!current) throw new ValidationError('Nothing is playing.');
    if (!current.track.info.isSeekable) throw new ValidationError('That track cannot be seeked (it is a stream).');
    const clamped = Math.max(0, Math.min(current.track.info.length, Math.floor(positionMs)));
    await node.updatePlayer({ guildId, position: clamped });
    return clamped;
  }

  setLoop(guildId: string, mode: LoopMode): LoopMode {
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    return player.queue.setLoop(mode);
  }

  cycleLoop(guildId: string): LoopMode {
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    return player.queue.cycleLoop();
  }

  shuffle(guildId: string): number {
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    return player.queue.shuffle();
  }

  remove(guildId: string, index: number): QueuedTrack | null {
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    return player.queue.remove(index);
  }

  clear(guildId: string): number {
    const player = this.players.get(guildId);
    if (!player) throw new ValidationError('Nothing is playing.');
    return player.queue.clear();
  }

  getPlayer(guildId: string): GuildPlayer | undefined {
    return this.players.get(guildId);
  }

  async stop(guildId: string, options: { destroy?: boolean } = {}): Promise<boolean> {
    const player = this.players.get(guildId);
    if (!player) return false;
    try {
      if (options.destroy !== false && this.lavalink) {
        await this.lavalink.destroyPlayer(guildId);
      } else if (this.lavalink) {
        await this.lavalink.updatePlayer({ guildId, encodedTrack: null, paused: true });
      }
    } catch (error) {
      this.logger.warn('music: stop failed', {
        guildId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.voice.leave(guildId);
    if (options.destroy !== false) this.players.delete(guildId);
    else player.queue.reset();
    return true;
  }

  async destroyAll(): Promise<void> {
    for (const guildId of [...this.players.keys()]) {
      await this.stop(guildId, { destroy: true });
    }
    this.lavalink?.close();
  }

  private handleNodeEvent(event: { type: string; guildId?: string }): void {
    if (event.type === 'closed') {
      this.logger.warn('music: node connection closed');
      return;
    }
    if (event.type !== 'trackEnd' || !event.guildId) return;
    const player = this.players.get(event.guildId);
    if (!player) return;
    const detail = event as { reason?: string };
    // finished/cleanup => advance; replaced/stopped => leave the queue alone.
    if (detail.reason === 'replaced' || detail.reason === 'stopped') return;
    void this.startNext(player).catch((error) => {
      this.logger.warn('music: failed to start next track', {
        guildId: event.guildId,
        error: error instanceof Error ? (error as Error).message : String(error),
      });
    });
  }
}

export type { ServiceUnavailableError };
