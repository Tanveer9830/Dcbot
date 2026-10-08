/**
 * Bounded in-memory sliding-window trackers used by anti-raid and anti-spam.
 *
 * Every map is size-capped and time-evicted so a large server cannot turn the
 * bot into a memory leak. For multi-shard deployments these should be backed by
 * Redis (REDIS_URL); the interface stays identical.
 */

export interface TrackerOptions {
  windowMs: number;
  maxKeys: number;
}

export class SlidingWindowTracker {
  private readonly events = new Map<string, number[]>();

  constructor(
    private readonly options: TrackerOptions,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Records an event and returns the count inside the current window. */
  push(key: string): number {
    const now = this.now();
    const cutoff = now - this.options.windowMs;
    const existing = (this.events.get(key) ?? []).filter((timestamp) => timestamp >= cutoff);
    existing.push(now);
    this.events.set(key, existing);
    if (this.events.size > this.options.maxKeys) this.evict(now);
    return existing.length;
  }

  /** Current window count without recording. */
  count(key: string): number {
    const cutoff = this.now() - this.options.windowMs;
    return (this.events.get(key) ?? []).filter((timestamp) => timestamp >= cutoff).length;
  }

  clear(key: string): void {
    this.events.delete(key);
  }

  private evict(now: number): void {
    const cutoff = now - this.options.windowMs;
    for (const [key, timestamps] of this.events) {
      const kept = timestamps.filter((timestamp) => timestamp >= cutoff);
      if (kept.length === 0) this.events.delete(key);
      else this.events.set(key, kept);
    }
  }

  get size(): number {
    return this.events.size;
  }
}

/** Keeps the last N items per key (used for repeated-message detection). */
export class RecentItemsTracker<T> {
  private readonly items = new Map<string, T[]>();

  constructor(
    private readonly limit = 10,
    private readonly maxKeys = 5_000,
  ) {}

  push(key: string, item: T): T[] {
    const list = this.items.get(key) ?? [];
    list.push(item);
    const trimmed = list.slice(-this.limit);
    this.items.set(key, trimmed);
    if (this.items.size > this.maxKeys) {
      const oldest = this.items.keys().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
    return trimmed;
  }

  get(key: string): T[] {
    return this.items.get(key) ?? [];
  }

  clear(key: string): void {
    this.items.delete(key);
  }
}
