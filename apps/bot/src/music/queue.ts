import type { LavalinkTrack, LoopMode, QueuedTrack } from './types.js';

export interface QueueSnapshot {
  current: QueuedTrack | null;
  upcoming: QueuedTrack[];
  loop: LoopMode;
  length: number;
  totalDurationMs: number;
}

/**
 * Playback queue.
 *
 * Pure data structure: no Discord and no Lavalink calls, which makes loop and
 * shuffle behaviour directly unit-testable.
 */
export class TrackQueue {
  private readonly upcoming: QueuedTrack[] = [];
  private current: QueuedTrack | null = null;
  private readonly history: QueuedTrack[] = [];
  private loop: LoopMode = 'off';
  private shuffled = false;

  constructor(private readonly maxItems = 500) {}

  get size(): number {
    return this.upcoming.length;
  }

  get isEmpty(): boolean {
    return this.current === null && this.upcoming.length === 0;
  }

  add(track: LavalinkTrack, requestedBy: string): number {
    if (this.upcoming.length >= this.maxItems) return this.upcoming.length;
    this.upcoming.push({ track, requestedBy });
    return this.upcoming.length;
  }

  addMany(tracks: LavalinkTrack[], requestedBy: string): number {
    for (const track of tracks) this.add(track, requestedBy);
    return this.upcoming.length;
  }

  /** Moves the next track into `current`, honouring the loop mode. */
  next(): QueuedTrack | null {
    if (this.current) {
      if (this.loop === 'track') {
        return this.current; // Same track again.
      }
      this.history.push(this.current);
      if (this.history.length > 50) this.history.shift();
      if (this.loop === 'queue') this.upcoming.push(this.current);
    }
    this.current = this.upcoming.shift() ?? null;
    return this.current;
  }

  /** Puts the current track back and returns the previous one. */
  previous(): QueuedTrack | null {
    const prior = this.history.pop();
    if (!prior) return null;
    if (this.current) this.upcoming.unshift(this.current);
    this.current = prior;
    return prior;
  }

  /** Skips the current track and returns what will play next. */
  skip(): QueuedTrack | null {
    return this.next();
  }

  remove(index: number): QueuedTrack | null {
    if (index < 0 || index >= this.upcoming.length) return null;
    return this.upcoming.splice(index, 1)[0] ?? null;
  }

  clear(): number {
    const removed = this.upcoming.length;
    this.upcoming.length = 0;
    return removed;
  }

  shuffle(random: () => number = Math.random): number {
    for (let i = this.upcoming.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = this.upcoming[i]!;
      this.upcoming[i] = this.upcoming[j]!;
      this.upcoming[j] = tmp;
    }
    this.shuffled = true;
    return this.upcoming.length;
  }

  get wasShuffled(): boolean {
    return this.shuffled;
  }

  setLoop(mode: LoopMode): LoopMode {
    this.loop = mode;
    return this.loop;
  }

  cycleLoop(): LoopMode {
    this.loop = this.loop === 'off' ? 'queue' : this.loop === 'queue' ? 'track' : 'off';
    return this.loop;
  }

  getLoop(): LoopMode {
    return this.loop;
  }

  getCurrent(): QueuedTrack | null {
    return this.current;
  }

  peek(count = 10): QueuedTrack[] {
    return this.upcoming.slice(0, count);
  }

  snapshot(): QueueSnapshot {
    return {
      current: this.current,
      upcoming: [...this.upcoming],
      loop: this.loop,
      length: this.upcoming.length,
      totalDurationMs: this.upcoming.reduce(
        (total, item) => total + (item.track.info.isStream ? 0 : item.track.info.length),
        0,
      ),
    };
  }

  /** Resets for a new connection; keeps nothing. */
  reset(): void {
    this.upcoming.length = 0;
    this.history.length = 0;
    this.current = null;
    this.loop = 'off';
    this.shuffled = false;
  }
}
