import type { Logger } from '../utils/logger.js';
import type { LavalinkPlayer, LavalinkTrack, LoadTracksResult } from './types.js';

export interface LavalinkOptions {
  host: string;
  port: number;
  password: string;
  secure?: boolean;
  /** User-Id header Lavalink requires. */
  userId: string;
  /** Number of shards Lavalink should expect. */
  shardCount?: number;
}

export type NodeEvent =
  | { type: 'ready' }
  | { type: 'closed' }
  | { type: 'trackStart'; guildId: string; track: LavalinkTrack }
  | { type: 'trackEnd'; guildId: string; track: LavalinkTrack; reason: string }
  | { type: 'trackException'; guildId: string; error: string }
  | { type: 'playerUpdate'; guildId: string; position: number };

export type NodeEventHandler = (event: NodeEvent) => void;

/**
 * Lavalink v4 client.
 *
 * REST for control, WebSocket for events. Audio itself is played by the
 * Lavalink node (it joins the Discord voice channel), which is why this project
 * does not need @discordjs/voice or native opus bindings.
 */
export class LavalinkClient {
  private socket: WebSocket | null = null;
  private readonly handlers = new Set<NodeEventHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manuallyClosed = false;
  private connected = false;
  private lastStats: Record<string, unknown> | null = null;

  constructor(
    private readonly options: LavalinkOptions,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get baseUrl(): string {
    const scheme = this.options.secure ? 'https' : 'http';
    return `${scheme}://${this.options.host}:${this.options.port}`;
  }

  private get wsUrl(): string {
    const scheme = this.options.secure ? 'wss' : 'ws';
    return `${scheme}://${this.options.host}:${this.options.port}/v4/websocket`;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get stats(): Record<string, unknown> | null {
    return this.lastStats;
  }

  on(handler: NodeEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: NodeEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        this.logger.warn('lavalink: handler threw', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Opens the WebSocket and keeps it open with exponential backoff. */
  connect(): void {
    if (this.socket || this.manuallyClosed) return;
    try {
      const socket = new WebSocket(this.wsUrl, {
        headers: {
          Authorization: this.options.password,
          'User-Id': this.options.userId,
          'Client-Name': 'Dcbot/0.1.0',
        },
      } as WebSocketInit);
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.emit({ type: 'ready' });
        this.logger.info('lavalink: node connected', { host: this.options.host, port: this.options.port });
      });

      socket.addEventListener('message', (event) => {
        const payload = String(event.data);
        try {
          const data = JSON.parse(payload) as Record<string, unknown>;
          this.handleMessage(data);
        } catch {
          this.logger.debug('lavalink: unparsable frame');
        }
      });

      socket.addEventListener('close', () => {
        this.connected = false;
        this.socket = null;
        this.emit({ type: 'closed' });
        this.scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        // The 'close' event follows and handles reconnection.
        this.logger.warn('lavalink: websocket error', { host: this.options.host });
      });
    } catch (error) {
      this.logger.warn('lavalink: failed to open websocket', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleReconnect();
    }
  }

  private handleMessage(data: Record<string, unknown>): void {
    const op = data.op as string | undefined;
    const guildId = data.guildId as string | undefined;
    switch (op) {
      case 'ready':
        this.logger.info('lavalink: session ready', { sessionId: String(data.sessionId ?? '').slice(0, 8) });
        break;
      case 'stats':
        this.lastStats = data;
        break;
      case 'playerUpdate':
        if (guildId) {
          const state = data.state as { position?: number } | undefined;
          this.emit({ type: 'playerUpdate', guildId, position: Number(state?.position ?? 0) });
        }
        break;
      case 'event': {
        const type = data.type as string;
        const track = data.track as LavalinkTrack | undefined;
        if (!guildId) break;
        if (type === 'TrackStartEvent' && track) this.emit({ type: 'trackStart', guildId, track });
        if (type === 'TrackEndEvent' && track) {
          this.emit({ type: 'trackEnd', guildId, track, reason: String(data.reason ?? '') });
        }
        if (type === 'TrackExceptionEvent') {
          const error = data.exception as { message?: string } | undefined;
          this.emit({ type: 'trackException', guildId, error: error?.message ?? 'unknown error' });
        }
        break;
      }
      default:
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(5, this.reconnectAttempts));
    this.logger.warn('lavalink: reconnecting', { attempt: this.reconnectAttempts, delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // --- REST ------------------------------------------------------------------

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.options.password,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Lavalink ${init.method ?? 'GET'} ${path} failed: ${response.status} ${body.slice(0, 200)}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Resolves a query, URL or search string into tracks. */
  async loadTracks(identifier: string): Promise<LoadTracksResult> {
    return this.request<LoadTracksResult>(`/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`);
  }

  async getPlayer(guildId: string): Promise<LavalinkPlayer | null> {
    try {
      return await this.request<LavalinkPlayer>(`/v4/sessions/default/players/${guildId}`);
    } catch {
      return null;
    }
  }

  async updatePlayer(params: {
    guildId: string;
    encodedTrack?: string | null;
    position?: number;
    paused?: boolean;
    volume?: number;
    voice?: { token: string; endpoint: string; sessionId: string };
  }): Promise<LavalinkPlayer> {
    const body: Record<string, unknown> = {};
    if (params.encodedTrack !== undefined) {
      body.encodedTrack = params.encodedTrack;
    }
    if (params.position !== undefined) body.position = params.position;
    if (params.paused !== undefined) body.paused = params.paused;
    if (params.volume !== undefined) body.volume = params.volume;
    if (params.voice) body.voice = params.voice;

    return this.request<LavalinkPlayer>(`/v4/sessions/default/players/${params.guildId}?noReplace=false`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async destroyPlayer(guildId: string): Promise<void> {
    await this.request<void>(`/v4/sessions/default/players/${guildId}`, { method: 'DELETE' });
  }

  /** GET /v4/lavalink - lightweight reachability probe used by health checks. */
  async probe(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const started = Date.now();
    try {
      await this.request<unknown>('/version');
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }
}
