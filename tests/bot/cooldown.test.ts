import { describe, expect, it } from 'vitest';
import { CooldownManager } from '../../apps/bot/src/utils/cooldown.js';

describe('CooldownManager', () => {
  it('allows up to maxHits inside the window and then blocks with a retry time', () => {
    const clock = 1_000;
    const cooldowns = new CooldownManager(() => clock);

    expect(cooldowns.check('user:cmd', 2, 10_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(cooldowns.check('user:cmd', 2, 10_000)).toMatchObject({ allowed: true, remaining: 0 });

    const blocked = cooldowns.check('user:cmd', 2, 10_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(10_000);
    expect(blocked.remaining).toBe(0);
  });

  it('slides the window forward', () => {
    let clock = 0;
    const cooldowns = new CooldownManager(() => clock);
    cooldowns.check('k', 1, 10_000);
    expect(cooldowns.check('k', 1, 10_000).allowed).toBe(false);

    clock = 9_999;
    expect(cooldowns.check('k', 1, 10_000).allowed).toBe(false);

    clock = 10_001;
    const retry = cooldowns.check('k', 1, 10_000);
    expect(retry.allowed).toBe(true);
  });

  it('keeps keys independent', () => {
    const cooldowns = new CooldownManager(() => 0);
    cooldowns.check('a', 1, 10_000);
    expect(cooldowns.check('b', 1, 10_000).allowed).toBe(true);
    expect(cooldowns.check('a', 1, 10_000).allowed).toBe(false);
  });

  it('can peek without consuming a hit', () => {
    const cooldowns = new CooldownManager(() => 0);
    expect(cooldowns.check('p', 1, 10_000, false).allowed).toBe(true);
    expect(cooldowns.check('p', 1, 10_000, false).allowed).toBe(true);
    expect(cooldowns.check('p', 1, 10_000).allowed).toBe(true);
    expect(cooldowns.check('p', 1, 10_000).allowed).toBe(false);
  });

  it('reports how long is left and resets on demand', () => {
    let clock = 0;
    const cooldowns = new CooldownManager(() => clock);
    cooldowns.check('r', 1, 10_000);
    clock = 4_000;
    expect(cooldowns.check('r', 1, 10_000).retryAfterMs).toBe(6_000);

    cooldowns.reset('r');
    expect(cooldowns.check('r', 1, 10_000).allowed).toBe(true);
  });

  it('sweeps expired buckets so state stays bounded', () => {
    let clock = 0;
    const cooldowns = new CooldownManager(() => clock);
    cooldowns.check('old', 1, 10_000);
    cooldowns.check('new', 1, 10_000);

    clock = 700_000; // beyond the 10 minute sweep horizon
    expect(cooldowns.sweep()).toBe(2);
    expect(cooldowns.sweep()).toBe(0);
  });
});
