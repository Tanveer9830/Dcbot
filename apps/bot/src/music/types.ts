/** Lavalink v4 data shapes (subset used by this bot). */

export interface LavalinkTrack {
  encoded: string;
  info: {
    identifier: string;
    isSeekable: boolean;
    author: string;
    length: number;
    isStream: boolean;
    position: number;
    title: string;
    uri: string | null;
    sourceName: string;
    artworkUrl: string | null;
    isrc: string | null;
  };
  pluginInfo?: Record<string, unknown>;
}

export interface LoadTracksResult {
  loadType: 'track' | 'playlist' | 'search' | 'error' | 'empty';
  data: LavalinkTrack | LavalinkTrack[] | { message: string; severity: string } | null;
}

export interface PlayerState {
  time: number;
  position: number;
  connected: boolean;
  ping: number;
}

export interface LavalinkPlayer {
  guildId: string;
  track: LavalinkTrack | null;
  state: PlayerState;
  volume: number;
  paused: boolean;
}

export type LoopMode = 'off' | 'track' | 'queue';

export interface QueuedTrack {
  track: LavalinkTrack;
  requestedBy: string;
}
