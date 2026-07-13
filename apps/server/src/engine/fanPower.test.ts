import { describe, expect, it } from 'vitest';
import { computeFanPower, type ScoredAnswer } from './fanPower.js';

describe('fanPower (раздел 8.3)', () => {
  it('без ответов → 50 (нейтрально)', () => {
    expect(computeFanPower([], 30)).toBeCloseTo(50, 5);
  });

  it('home идеально, away мимо → сдвиг к home, clamp по MAX=92', () => {
    const answers: ScoredAnswer[] = [
      { minute: 25, side: 'home', correct: true },
      { minute: 26, side: 'away', correct: false },
    ];
    // accHome=1, accAway=0 → 50 + 42*1 = 92
    expect(computeFanPower(answers, 30)).toBeCloseTo(92, 5);
  });

  it('away доминирует → clamp по MIN=8', () => {
    const answers: ScoredAnswer[] = [
      { minute: 25, side: 'home', correct: false },
      { minute: 26, side: 'away', correct: true },
    ];
    expect(computeFanPower(answers, 30)).toBeCloseTo(8, 5);
  });

  it('учитывает только окно последних 10 игровых минут', () => {
    const answers: ScoredAnswer[] = [
      { minute: 5, side: 'home', correct: true }, // outside window (30-10=20)
      { minute: 25, side: 'home', correct: false },
    ];
    // Only one home answer is inside the window (wrong): accHome=0, accAway=0.5 → 50 + 42*(0-0.5)=29
    expect(computeFanPower(answers, 30)).toBeCloseTo(29, 5);
  });
});
