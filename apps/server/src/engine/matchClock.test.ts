import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchInfo, OddsUpdate, ServerMessage } from '@fan-raid/shared';
import { BaseFeed } from '../feed/FeedSource.js';
import { MatchRoom, type RoomBroadcaster } from './MatchRoom.js';

class ClockFeed extends BaseFeed {
  start(): void {}
  stop(): void {}

  pushOdds(update: OddsUpdate): void {
    this.emitOdds(update);
  }
}

describe('MatchRoom: real match clock fallback', () => {
  afterEach(() => vi.useRealTimers());

  it('infers the live minute from startsAt when TxODDS sends minute 0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T19:10:00.000Z'));

    const broadcast: ServerMessage[] = [];
    const broadcaster: RoomBroadcaster = {
      broadcast: (message) => broadcast.push(message),
      toPlayer: () => {},
    };
    const matchInfo: MatchInfo = {
      id: 'real-match',
      externalId: '18241006',
      source: 'txodds',
      isReal: true,
      teams: { home: 'England', away: 'Argentina' },
      competition: 'World Cup',
      startsAt: '2026-07-15T19:00:00.000Z',
      status: 'live',
    };
    const room = new MatchRoom(broadcaster, 1, {}, 1, matchInfo);
    const feed = new ClockFeed();

    room.start(feed);
    vi.advanceTimersByTime(100);

    expect(room.snapshotFor().minute).toBe(10);
    expect(room.currentPhase).toBe('first_half');

    feed.pushOdds({
      matchId: 'real-match',
      ts: Date.now(),
      minute: 0,
      probs: { home: 0.4, draw: 0.26, away: 0.34 },
    });

    expect(room.snapshotFor().minute).toBe(10);

    room.stop();
  });
});
