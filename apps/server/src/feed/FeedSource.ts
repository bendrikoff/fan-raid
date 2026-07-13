import type { MatchEvent, OddsUpdate } from '@fan-raid/shared';

// Data source interface (section 5.1).
export interface FeedSource {
  start(matchId: string): void;
  stop(): void;
  on(event: 'odds', cb: (u: OddsUpdate) => void): void;
  on(event: 'match', cb: (e: MatchEvent) => void): void;
}

// Small typed base class with two event channels.
export abstract class BaseFeed implements FeedSource {
  private oddsCbs: Array<(u: OddsUpdate) => void> = [];
  private matchCbs: Array<(e: MatchEvent) => void> = [];

  abstract start(matchId: string): void;
  abstract stop(): void;

  on(event: 'odds', cb: (u: OddsUpdate) => void): void;
  on(event: 'match', cb: (e: MatchEvent) => void): void;
  on(event: 'odds' | 'match', cb: ((u: OddsUpdate) => void) | ((e: MatchEvent) => void)): void {
    if (event === 'odds') this.oddsCbs.push(cb as (u: OddsUpdate) => void);
    else this.matchCbs.push(cb as (e: MatchEvent) => void);
  }

  protected emitOdds(u: OddsUpdate): void {
    for (const cb of this.oddsCbs) cb(u);
  }

  protected emitMatch(e: MatchEvent): void {
    for (const cb of this.matchCbs) cb(e);
  }
}
