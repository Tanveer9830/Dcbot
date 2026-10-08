/**
 * Spotify handling - what is actually possible, stated honestly.
 *
 * Spotify's streaming API does not permit a third-party bot to pull audio for
 * playback, so this project NEVER plays Spotify audio directly. Instead:
 *   1. The URL is parsed (track/album/playlist + id).
 *   2. If SPOTIFY_CLIENT_ID/SECRET are configured, the Web API is called for
 *      metadata (name, artists) using the client-credentials flow.
 *   3. The resolved name/artist is searched on whatever playback source the
 *      Lavalink node has enabled (commonly YouTube via yt-source plugin).
 *   4. Without credentials we fall back to the id only, which usually does not
 *      resolve - the caller then tells the user to configure credentials.
 */

export type SpotifyKind = 'track' | 'album' | 'playlist' | 'artist' | 'unknown';

export interface SpotifyLink {
  kind: SpotifyKind;
  id: string;
  url: string;
  /** The `si` share parameter, when the link was copied from the app. */
  shareId?: string;
}

export interface ResolvedSpotify {
  kind: SpotifyKind;
  queries: string[];
  titles: Array<{ title: string; artist: string }>;
  source: 'spotify_api' | 'url_only';
}

const SPOTIFY_URL = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/i;

/** Parses an open.spotify.com URL. Returns null when it is not a Spotify link. */
export function parseSpotifyUrl(url: string): SpotifyLink | null {
  const trimmed = url.trim();
  const match = trimmed.match(SPOTIFY_URL);
  if (!match) return null;
  const shareId = trimmed.match(/[?&]si=([^&#]+)/i)?.[1];
  return {
    kind: match[1]!.toLowerCase() as SpotifyKind,
    id: match[2]!,
    url: match[0],
    ...(shareId ? { shareId } : {}),
  };
}

export function isSpotifyUrl(url: string): boolean {
  return parseSpotifyUrl(url) !== null;
}

export class SpotifyMetadataClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string | undefined,
    private readonly clientSecret: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async getToken(): Promise<string | null> {
    if (!this.isConfigured) return null;
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await this.fetchImpl('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) {
      throw new Error(`Spotify token request failed: ${response.status}`);
    }
    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return this.token.value;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.getToken();
    if (!token) throw new Error('Spotify credentials are not configured.');
    const response = await this.fetchImpl(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Spotify API ${path} failed: ${response.status}`);
    return (await response.json()) as T;
  }

  /**
   * Resolves a Spotify link into search queries for the playback source.
   * Playlists/albums are capped so a 300-track playlist cannot hang the bot.
   */
  async resolve(link: SpotifyLink, limit = 25): Promise<ResolvedSpotify> {
    if (!this.isConfigured) {
      return { kind: link.kind, queries: [], titles: [], source: 'url_only' };
    }

    if (link.kind === 'track') {
      const data = await this.get<{ name: string; artists: Array<{ name: string }> }>(`/tracks/${link.id}`);
      const artist = data.artists.map((entry) => entry.name).join(', ');
      return {
        kind: 'track',
        queries: [`${artist} ${data.name}`.trim()],
        titles: [{ title: data.name, artist }],
        source: 'spotify_api',
      };
    }

    if (link.kind === 'album') {
      const data = await this.get<{
        name: string;
        artists: Array<{ name: string }>;
        tracks: { items: Array<{ name: string; artists: Array<{ name: string }> }> };
      }>(`/albums/${link.id}`);
      const albumArtist = data.artists.map((entry) => entry.name).join(', ');
      const titles = data.tracks.items.slice(0, limit).map((item) => ({
        title: item.name,
        artist: item.artists.map((entry) => entry.name).join(', ') || albumArtist,
      }));
      return {
        kind: 'album',
        queries: titles.map((item) => `${item.artist} ${item.title}`.trim()),
        titles,
        source: 'spotify_api',
      };
    }

    if (link.kind === 'playlist') {
      const data = await this.get<{
        name: string;
        tracks: { items: Array<{ track: { name: string; artists: Array<{ name: string }> } | null }> };
      }>(`/playlists/${link.id}?limit=100`);
      const titles = data.tracks.items
        .map((item) => item.track)
        .filter((item): item is { name: string; artists: Array<{ name: string }> } => Boolean(item))
        .slice(0, limit)
        .map((item) => ({
          title: item.name,
          artist: item.artists.map((entry) => entry.name).join(', '),
        }));
      return {
        kind: 'playlist',
        queries: titles.map((item) => `${item.artist} ${item.title}`.trim()),
        titles,
        source: 'spotify_api',
      };
    }

    return { kind: link.kind, queries: [], titles: [], source: 'url_only' };
  }
}
