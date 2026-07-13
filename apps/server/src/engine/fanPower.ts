import { FAN_POWER, clamp, type TeamSide } from '@fan-raid/shared';

// Answered-question record for the Fan Power window.
// Only actually answered questions are counted (correct/wrong);
// misses and void results are not included in accuracy.
export interface ScoredAnswer {
  minute: number;
  side: TeamSide;
  correct: boolean;
}

// Side accuracy inside the window; when there are no answers, use NEUTRAL_ACC (0.5).
function sideAccuracy(answers: ScoredAnswer[], side: TeamSide): number {
  const rows = answers.filter((a) => a.side === side);
  if (rows.length === 0) return FAN_POWER.NEUTRAL_ACC;
  const correct = rows.filter((a) => a.correct).length;
  return correct / rows.length;
}

// Fan Power (section 8.3): rolling share of correct home answers over
// the last 10 game minutes, smoothed into range [8, 92].
// fp = clamp(8, 92, 50 + 42 * (accHome − accAway)).
export function computeFanPower(allAnswers: ScoredAnswer[], currentMinute: number): number {
  const from = currentMinute - FAN_POWER.WINDOW_GAME_MINUTES;
  const window = allAnswers.filter((a) => a.minute > from && a.minute <= currentMinute);
  const accHome = sideAccuracy(window, 'home');
  const accAway = sideAccuracy(window, 'away');
  return clamp(FAN_POWER.MIN, FAN_POWER.MAX, FAN_POWER.BASE + FAN_POWER.SPREAD * (accHome - accAway));
}
