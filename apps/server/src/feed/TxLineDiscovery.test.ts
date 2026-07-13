import { describe, expect, it } from 'vitest';
import { parseTxLineFixture, selectTxLineFixture } from './TxLineDiscovery.js';

describe('TxLineDiscovery', () => {
  it('maps Participant1IsHome into home and away teams', () => {
    const fixture = parseTxLineFixture({
      FixtureId: 18175983,
      Participant1: 'Germany',
      Participant2: 'Paraguay',
      Participant1IsHome: true,
      StartTime: '2026-06-29T20:30:00.000Z',
      Competition: 'World Cup',
    });

    expect(fixture?.fixtureId).toBe('18175983');
    expect(fixture?.home).toBe('Germany');
    expect(fixture?.away).toBe('Paraguay');
    expect(fixture?.competition).toBe('World Cup');
  });

  it('parses TxODDS epoch millisecond start times', () => {
    const fixture = parseTxLineFixture(
      {
        FixtureId: 18143850,
        Participant1: 'Vietnam',
        Participant2: 'Myanmar',
        Participant1IsHome: true,
        StartTime: 1784386800000,
        Competition: 'Friendlies',
        GameState: 1,
      },
      Date.parse('2026-07-09T00:00:00.000Z'),
    );

    expect(fixture?.startsAt).toBe('2026-07-18T15:00:00.000Z');
    expect(fixture?.status).toBe('upcoming');
    expect(fixture?.home).toBe('Vietnam');
    expect(fixture?.away).toBe('Myanmar');
  });

  it('flips teams when Participant1IsHome is false', () => {
    const fixture = parseTxLineFixture({
      FixtureId: 1,
      Participant1: 'Away listed first',
      Participant2: 'Home listed second',
      Participant1IsHome: false,
    });

    expect(fixture?.home).toBe('Home listed second');
    expect(fixture?.away).toBe('Away listed first');
  });

  it('auto-picks live fixture before upcoming fixture', () => {
    const now = Date.parse('2026-07-08T20:30:00.000Z');
    const selected = selectTxLineFixture(
      [
        { FixtureId: 10, Participant1: 'Future', Participant2: 'Team', Participant1IsHome: true, StartTime: '2026-07-09T20:00:00.000Z' },
        { FixtureId: 20, Participant1: 'Live', Participant2: 'Team', Participant1IsHome: true, StartTime: '2026-07-08T20:00:00.000Z' },
      ],
      '',
      now,
    );

    expect(selected?.fixtureId).toBe('20');
    expect(selected?.status).toBe('live');
  });

  it('honors preferred fixture id as an override', () => {
    const selected = selectTxLineFixture(
      [
        { FixtureId: 10, Participant1: 'A', Participant2: 'B', Participant1IsHome: true },
        { FixtureId: 20, Participant1: 'C', Participant2: 'D', Participant1IsHome: true },
      ],
      '10',
      Date.now(),
    );

    expect(selected?.fixtureId).toBe('10');
  });
});
