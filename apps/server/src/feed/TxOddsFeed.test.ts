import { describe, expect, it } from 'vitest';
import { normalizeTxOddsMessage } from './TxOddsFeed.js';

describe('TxOddsFeed normalizer', () => {
  it('maps direct decimal odds into normalized probabilities', () => {
    const res = normalizeTxOddsMessage(
      { minute: 12, odds: { home: 2, draw: 4, away: 4 } },
      { matchId: 'm1', fallbackMinute: 0 },
    );

    expect(res.events).toHaveLength(0);
    expect(res.odds).toHaveLength(1);
    expect(res.odds[0]?.minute).toBe(12);
    expect(res.odds[0]?.probs.home).toBeCloseTo(0.5, 4);
    expect(res.odds[0]?.probs.draw).toBeCloseTo(0.25, 4);
    expect(res.odds[0]?.probs.away).toBeCloseTo(0.25, 4);
  });

  it('maps 1X2 market selections', () => {
    const res = normalizeTxOddsMessage(
      {
        matchMinute: '18',
        markets: [
          {
            name: 'Match Odds',
            selections: [
              { name: 'Home', price: 1.8 },
              { name: 'Draw', price: 3.4 },
              { name: 'Away', price: 4.1 },
            ],
          },
        ],
      },
      { matchId: 'm1', fallbackMinute: 0 },
    );

    expect(res.odds).toHaveLength(1);
    expect(res.odds[0]?.minute).toBe(18);
    expect(res.odds[0]?.probs.home).toBeGreaterThan(res.odds[0]?.probs.away ?? 0);
  });

  it('supports configured JSON paths', () => {
    const res = normalizeTxOddsMessage(
      { payload: { clock: 31, h: '45%', d: '30%', a: '25%' } },
      {
        matchId: 'm1',
        fallbackMinute: 0,
        minutePath: 'payload.clock',
        oddsHomePath: 'payload.h',
        oddsDrawPath: 'payload.d',
        oddsAwayPath: 'payload.a',
      },
    );

    expect(res.odds).toHaveLength(1);
    expect(res.odds[0]?.minute).toBe(31);
    expect(res.odds[0]?.probs.home).toBeCloseTo(0.45, 4);
    expect(res.odds[0]?.probs.draw).toBeCloseTo(0.3, 4);
    expect(res.odds[0]?.probs.away).toBeCloseTo(0.25, 4);
  });

  it('unwraps common data containers automatically', () => {
    const res = normalizeTxOddsMessage(
      { data: { minute: 7, probabilities: { home: 0.4, draw: 0.3, away: 0.3 } } },
      { matchId: 'm1', fallbackMinute: 0 },
    );

    expect(res.odds).toHaveLength(1);
    expect(res.odds[0]?.minute).toBe(7);
    expect(res.odds[0]?.probs.home).toBeCloseTo(0.4, 4);
  });

  it('maps common match events', () => {
    const res = normalizeTxOddsMessage(
      { event: { type: 'goal', team: 'away' }, minute: 52, timestamp: 1_800_000_000 },
      { matchId: 'm1', fallbackMinute: 0 },
    );

    expect(res.events).toEqual([
      { matchId: 'm1', ts: 1_800_000_000_000, minute: 52, type: 'goal', team: 'away' },
    ]);
  });

  it('maps TxLINE PriceNames and Pct odds payloads', () => {
    const res = normalizeTxOddsMessage(
      {
        FixtureId: 17952170,
        Ts: 1_800_000_000,
        PriceNames: ['Home', 'Draw', 'Away'],
        Pct: ['45', '30', '25'],
      },
      { matchId: 'm1', fallbackMinute: 0, externalMatchId: '17952170' },
    );

    expect(res.events).toHaveLength(0);
    expect(res.odds).toHaveLength(1);
    expect(res.odds[0]?.ts).toBe(1_800_000_000_000);
    expect(res.odds[0]?.probs.home).toBeCloseTo(0.45, 4);
    expect(res.odds[0]?.probs.draw).toBeCloseTo(0.3, 4);
    expect(res.odds[0]?.probs.away).toBeCloseTo(0.25, 4);
  });

  it('ignores TxLINE updates for a different fixture', () => {
    const res = normalizeTxOddsMessage(
      {
        FixtureId: 111,
        PriceNames: ['Home', 'Draw', 'Away'],
        Pct: ['45', '30', '25'],
      },
      { matchId: 'm1', fallbackMinute: 0, externalMatchId: '222' },
    );

    expect(res.events).toHaveLength(0);
    expect(res.odds).toHaveLength(0);
  });

  it('maps TxLINE soccer score actions into match events', () => {
    const res = normalizeTxOddsMessage(
      {
        fixtureId: 17952170,
        ts: 1_800_000_000,
        participant1IsHome: true,
        dataSoccer: {
          Action: 'Goal',
          Participant: 2,
          New: { Minutes: 54 },
        },
      },
      { matchId: 'm1', fallbackMinute: 0, externalMatchId: '17952170' },
    );

    expect(res.odds).toHaveLength(0);
    expect(res.events).toEqual([
      { matchId: 'm1', ts: 1_800_000_000_000, minute: 54, type: 'goal', team: 'away' },
    ]);
  });
});
