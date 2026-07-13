import { describe, expect, it } from 'vitest';
import { buildMatchSummary, computeRaidWinner } from './settlement.js';

describe('computeRaidWinner (по Силе фанатов)', () => {
  it('fanPower > 50 → home', () => {
    expect(computeRaidWinner(63)).toBe('home');
  });
  it('fanPower < 50 → away', () => {
    expect(computeRaidWinner(31)).toBe('away');
  });
  it('ровно 50 → ничья', () => {
    expect(computeRaidWinner(50)).toBe('draw');
  });
});

describe('buildMatchSummary', () => {
  it('считает победителя рейда по fanPower, топ, точность и хэш лога', () => {
    const summary = buildMatchSummary({
      score: { home: 2, away: 1 },
      fanPower: 68,
      players: [
        { id: 'a', name: 'Аня', side: 'home', points: 500, bestStreak: 5, impact: 120, correctCount: 5, answeredCount: 6 },
        { id: 'b', name: 'Боб', side: 'away', points: 200, bestStreak: 2, impact: 40, correctCount: 2, answeredCount: 5 },
      ],
      answers: [{ playerId: 'a', questionId: 'q1', option: 0, result: 'correct', ts: 1 }],
    });
    expect(summary.winningSide).toBe('home');
    expect(summary.raidWinner).toBe('home');
    expect(summary.finalFanPower).toBe(68);
    expect(summary.totalImpact).toEqual({ home: 120, away: 40 });
    expect(summary.top10[0]?.name).toBe('Аня');
    expect(summary.players[0]?.accuracy).toBeCloseTo(5 / 6, 5);
    expect(summary.answersLogSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
