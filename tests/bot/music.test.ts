import { describe, expect, it } from 'vitest';
import { isSpotifyUrl, parseSpotifyUrl } from '../../apps/bot/src/music/spotify.js';
import { TrackQueue } from '../../apps/bot/src/music/queue.js';
import type { LavalinkTrack } from '../../apps/bot/src/music/types.js';

function track(id: string, length = 200_000, isStream = false): LavalinkTrack {
  return {
    encoded: `encoded-${id}`,
    info: {
      identifier: id,
      isSeekable: !isStream,
      author: 'Artist',
      length,
      isStream,
      position: 0,
      title: `Track ${id}`,
      uri: null,
      sourceName: 'youtube',
      artworkUrl: null,
      isrc: null,
    },
  };
}

describe('Spotify link parsing', () => {
  it('recognises track, album, playlist and artist links', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')).toMatchObject({
      kind: 'track',
      id: '4cOdK2wGLETKBW3PvgPWqT',
    });
    expect(parseSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')?.kind).toBe('playlist');
    expect(parseSpotifyUrl('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3')?.kind).toBe('album');
    expect(parseSpotifyUrl('https://open.spotify.com/artist/06HL4z0CvFAxyc27GXpf02')?.kind).toBe('artist');
  });

  it('handles internationalised paths and share parameters', () => {
    const parsed = parseSpotifyUrl('https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123');
    expect(parsed).toMatchObject({ kind: 'track', id: '4cOdK2wGLETKBW3PvgPWqT', shareId: 'abc123' });
  });

  it('rejects everything that is not a Spotify link', () => {
    for (const url of [
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://open.spotify.com/user/someone',
      'not a url',
      '',
      'https://notopen.spotify.com/track/abc',
    ]) {
      expect(parseSpotifyUrl(url), url).toBeNull();
      expect(isSpotifyUrl(url), url).toBe(false);
    }
    expect(isSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')).toBe(true);
  });
});

describe('TrackQueue', () => {
  it('queues, plays in order and reports what is playing', () => {
    const queue = new TrackQueue();
    expect(queue.isEmpty).toBe(true);
    expect(queue.next()).toBeNull();

    queue.addMany([track('1'), track('2'), track('3')], 'user-1');
    expect(queue.size).toBe(3);
    expect(queue.snapshot().totalDurationMs).toBe(600_000);

    expect(queue.next()?.track.info.identifier).toBe('1');
    expect(queue.getCurrent()?.track.info.identifier).toBe('1');
    expect(queue.next()?.track.info.identifier).toBe('2');
  });

  it('respects the queue cap', () => {
    const queue = new TrackQueue(2);
    queue.addMany([track('1'), track('2'), track('3')], 'user-1');
    expect(queue.size).toBe(2);
  });

  it('excludes streams from the duration estimate', () => {
    const queue = new TrackQueue();
    queue.addMany([track('1', 60_000), track('live', 0, true)], 'user-1');
    expect(queue.snapshot().totalDurationMs).toBe(60_000);
  });

  it('loops a single track and the whole queue', () => {
    const trackLoop = new TrackQueue();
    trackLoop.add(track('1'), 'user-1');
    trackLoop.setLoop('track');
    trackLoop.next();
    expect(trackLoop.next()?.track.info.identifier).toBe('1');
    expect(trackLoop.size).toBe(0);

    const queueLoop = new TrackQueue();
    queueLoop.addMany([track('1'), track('2')], 'user-1');
    queueLoop.setLoop('queue');
    queueLoop.next(); // plays 1
    queueLoop.next(); // plays 2, requeues 1
    expect(queueLoop.size).toBe(1);
    expect(queueLoop.next()?.track.info.identifier).toBe('1');
  });

  it('cycles the loop mode off -> queue -> track -> off', () => {
    const queue = new TrackQueue();
    expect(queue.getLoop()).toBe('off');
    expect(queue.cycleLoop()).toBe('queue');
    expect(queue.cycleLoop()).toBe('track');
    expect(queue.cycleLoop()).toBe('off');
  });

  it('goes back to the previous track', () => {
    const queue = new TrackQueue();
    queue.addMany([track('1'), track('2'), track('3')], 'user-1');
    queue.next();
    queue.next();
    expect(queue.getCurrent()?.track.info.identifier).toBe('2');
    expect(queue.previous()?.track.info.identifier).toBe('1');
    expect(queue.getCurrent()?.track.info.identifier).toBe('1');
  });

  it('removes by index and clears', () => {
    const queue = new TrackQueue();
    queue.addMany([track('1'), track('2'), track('3')], 'user-1');
    expect(queue.remove(1)?.track.info.identifier).toBe('2');
    expect(queue.remove(9)).toBeNull();
    expect(queue.remove(-1)).toBeNull();
    expect(queue.clear()).toBe(2);
    expect(queue.size).toBe(0);
  });

  it('shuffles without losing or duplicating tracks', () => {
    const queue = new TrackQueue();
    const ids = ['1', '2', '3', '4', '5', '6'];
    queue.addMany(ids.map((id) => track(id)), 'user-1');

    let seed = 0;
    const deterministic = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    queue.shuffle(deterministic);

    const played: string[] = [];
    let next = queue.next();
    while (next) {
      played.push(next.track.info.identifier);
      next = queue.next();
    }
    expect(played.sort()).toEqual([...ids].sort());
    expect(queue.wasShuffled).toBe(true);
  });

  it('resets between connections', () => {
    const queue = new TrackQueue();
    queue.addMany([track('1'), track('2')], 'user-1');
    queue.next();
    queue.setLoop('queue');
    queue.reset();
    expect(queue.isEmpty).toBe(true);
    expect(queue.getLoop()).toBe('off');
    expect(queue.getCurrent()).toBeNull();
  });
});
