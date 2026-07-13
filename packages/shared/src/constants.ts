// ---------------------------------------------------------------------------
// Fan Raid — all game constants (design doc section 8).
// RULE: game constants are NOT hardcoded in logic — they live only here.
// ---------------------------------------------------------------------------

import type { QuestionTypeId } from './types.js';

export const MATCH_ID = 'brazil-germany';

export const TEAM_NAMES = {
  home: 'Brazil',
  away: 'Germany',
} as const;

// Side colors (section 13).
export const TEAM_COLORS = {
  home: '#639922',
  away: '#D85A30',
} as const;

// --- Match timing ---------------------------------------------------------

export const MATCH = {
  FIRST_HALF_END_MINUTE: 45,
  SECOND_HALF_END_MINUTE: 90,
  HALFTIME_GAME_SECONDS: 20, // halftime duration in game seconds
  // 1 game minute = 60000 / SIM_SPEED ms. At 12, the match takes ~7.5 real minutes,
  // and the answer window (see QUESTION.OPEN_GAME_SECONDS = 72 game sec) is a comfortable ~6 sec.
  DEFAULT_SIM_SPEED: 12,
  DEFAULT_REPLAY_SPEED: 10,
} as const;

// --- Cards → Fan Power shift (section 9, reworked without bosses) ----------
// A card against one side shifts Fan Power toward the opponent.
export const CARD_FANPOWER_SHIFT = {
  yellow: 1.5, // yellow — small pp shift
  red: 4, // red — noticeable pp shift
} as const;

// --- Questions (section 7) ------------------------------------------------

export const QUESTION = {
  OPEN_GAME_SECONDS: 72, // answer window (~6 real seconds at SIM_SPEED=12)
  GAP_MIN_GAME_SECONDS: 45, // pause between questions (min)
  GAP_MAX_GAME_SECONDS: 75, // pause between questions (max)
  GOAL_WINDOW_MINUTES: 10, // GOAL_IN_WINDOW
  PROB_DELTA_MINUTES: 8, // PROB_DELTA window
  PROB_DELTA_THRESHOLD: 0.05, // 5 pp
  CORNER_BONUS_GAME_SECONDS: 10, // bonus question window
  CORNER_BONUS_RESOLVE_MINUTES: 2, // bonus resolve window (shot_on_target within 2 min)
} as const;

// Event question types rotate without repeating the previous type (section 7.2).
export const ROTATING_QUESTION_TYPES: QuestionTypeId[] = [
  'NEXT_EVENT_TYPE',
  'NEXT_DANGER_TEAM',
  'GOAL_IN_WINDOW',
  'CARD_BEFORE_BREAK',
];

// --- Scoring (sections 8.1, 8.2) ------------------------------------------

export const SCORING = {
  STREAK_CAP: 5, // multiplier is capped at 5
  POINTS_PER_CORRECT_BASE: 100, // points += 100 * min(streak, cap)
  DAMAGE_BASE: 10, // damage = DAMAGE_BASE + DAMAGE_PER_STREAK * min(streak, cap)
  DAMAGE_PER_STREAK: 3,
} as const;

// --- Fan Power (section 8.3) ----------------------------------------------

export const FAN_POWER = {
  WINDOW_GAME_MINUTES: 10, // rolling window
  BASE: 50,
  SPREAD: 42, // fp = clamp(MIN, MAX, BASE + SPREAD * (accHome - accAway))
  MIN: 8,
  MAX: 92,
  NEUTRAL_ACC: 0.5, // acc when there are no answers
} as const;

// --- SimFeed (section 5.3) ------------------------------------------------

export const SIM = {
  TEAM_STRENGTH_MIN: 0.4,
  TEAM_STRENGTH_MAX: 0.6,
  // Base event chances per game minute (weighted by attacking-side strength).
  P_SHOT: 0.12,
  P_SHOT_ON_TARGET: 0.06,
  P_CORNER: 0.08,
  P_YELLOW: 0.03,
  P_RED: 0.003,
  P_GOAL: 0.025,
  // Probability recalculation.
  GOAL_PROB_SHIFT_MIN: 0.15, // winning side +15..25 pp
  GOAL_PROB_SHIFT_MAX: 0.25,
  CARD_PROB_SHIFT_MIN: 0.02, // cards — 2..5 pp
  CARD_PROB_SHIFT_MAX: 0.05,
  DRIFT_PER_MINUTE: 0.005, // drift ±0.5 pp/min
} as const;

// Probability jump threshold for the "Market sensed danger" toast (section 9).
export const PROB_JUMP_TOAST_THRESHOLD = 0.06; // 6 pp

export function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}
