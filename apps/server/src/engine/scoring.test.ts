import { describe, expect, it } from 'vitest';
import { impactForCorrect, pointsForCorrect, streakMultiplier } from './scoring.js';

describe('scoring (раздел 8.1)', () => {
  it('множитель серии капится на 5', () => {
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(5)).toBe(5);
    expect(streakMultiplier(9)).toBe(5);
  });

  it('очки = 100 * min(streak, 5)', () => {
    expect(pointsForCorrect(1)).toBe(100);
    expect(pointsForCorrect(3)).toBe(300);
    expect(pointsForCorrect(5)).toBe(500);
    expect(pointsForCorrect(8)).toBe(500);
  });

  it('вклад = 10 + 3 * min(streak, 5)', () => {
    expect(impactForCorrect(1)).toBe(13);
    expect(impactForCorrect(3)).toBe(19);
    expect(impactForCorrect(5)).toBe(25);
    expect(impactForCorrect(10)).toBe(25);
  });
});
