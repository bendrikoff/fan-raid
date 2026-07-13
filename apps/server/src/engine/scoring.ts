import { SCORING } from '@fan-raid/shared';

// Scoring and damage (sections 8.1, 8.2). Pure functions — covered by tests.
// In all formulas, `streak` is the streak AFTER incrementing for a correct answer.

// Streak multiplier, capped by STREAK_CAP.
export function streakMultiplier(streak: number): number {
  return Math.min(streak, SCORING.STREAK_CAP);
}

// points += 100 * min(streak, 5).
export function pointsForCorrect(streak: number): number {
  return SCORING.POINTS_PER_CORRECT_BASE * streakMultiplier(streak);
}

// Side power contribution for a correct answer: impact = 10 + 3 * min(streak, 5).
export function impactForCorrect(streak: number): number {
  return SCORING.DAMAGE_BASE + SCORING.DAMAGE_PER_STREAK * streakMultiplier(streak);
}
