/**
 * In-memory cooldown + rate-limit tracker.
 *
 * Scoped per (key, bucket). Deliberately bounded: entries are evicted once they
 * expire so a long-running process does not accumulate unbounded state. For
 * multi-shard deployments set REDIS_URL and use a shared store (documented in
 * docs/DEPLOYMENT.md); single-process correctness is what this guarantees.
 */

interface Bucket {
  hits: number[];
}

export interface CooldownResult {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

export class CooldownManager {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Sliding-window check. `maxHits` within `windowMs`.
   * `consume` records the hit; pass false to peek without consuming.
   */
  check(key: string, maxHits: number, windowMs: number, consume = true): CooldownResult {
    const now = this.now();
    const cutoff = now - windowMs;
    const bucket = this.buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((timestamp) => timestamp > cutoff);

    if (bucket.hits.length >= maxHits) {
      const oldest = bucket.hits[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(0, oldest + windowMs - now), remaining: 0 };
    }
    if (consume) bucket.hits.push(now);
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, maxHits - bucket.hits.length) };
  }

  /** Clears a user's cooldown (used by the pardon command and by tests). */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Drops expired buckets. Called by the automation sweep. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      bucket.hits = bucket.hits.filter((timestamp) => timestamp > now - 600_000);
      if (bucket.hits.length === 0) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}
