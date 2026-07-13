import { createHash } from 'node:crypto';
import {
  MATCH_ID,
  type LeaderboardEntry,
  type MatchSummary,
  type PlayerSummary,
  type Score,
  type TeamSide,
} from '@fan-raid/shared';

export interface SettlementPlayer {
  id: string;
  name: string;
  avatarUrl?: string;
  side: TeamSide;
  points: number;
  bestStreak: number;
  impact: number;
  correctCount: number;
  answeredCount: number;
}

export interface AnswerLogRow {
  playerId: string;
  questionId: string;
  option: number;
  result: string;
  ts: number;
}

function accuracy(p: SettlementPlayer): number {
  return p.answeredCount === 0 ? 0 : p.correctCount / p.answeredCount;
}

// sha256 hash of the full answer log (for on-chain anchoring, section 12).
export function hashAnswerLog(rows: AnswerLogRow[]): string {
  const canonical = rows
    .map((r) => `${r.playerId}|${r.questionId}|${r.option}|${r.result}|${r.ts}`)
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

// Raid winner is determined by the final Fan Power (fanPower — home share).
// > 50 → home, < 50 → away, exactly 50 → draw.
export function computeRaidWinner(fanPower: number): TeamSide | 'draw' {
  if (fanPower > 50) return 'home';
  if (fanPower < 50) return 'away';
  return 'draw';
}

export function buildMatchSummary(args: {
  matchId?: string;
  score: Score;
  fanPower: number;
  players: SettlementPlayer[];
  answers: AnswerLogRow[];
}): MatchSummary {
  const { score, fanPower, players, answers } = args;

  const totalImpact = { home: 0, away: 0 };
  for (const p of players) totalImpact[p.side] += p.impact;

  const raidWinner = computeRaidWinner(fanPower);

  const winningSide: TeamSide | 'draw' =
    score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'draw';

  const sorted = [...players].sort((a, b) => b.points - a.points);
  const top10: LeaderboardEntry[] = sorted.slice(0, 10).map((p) => ({
    playerId: p.id,
    name: p.name,
    avatarUrl: p.avatarUrl,
    side: p.side,
    points: p.points,
  }));

  const playerSummaries: PlayerSummary[] = sorted.map((p) => ({
    id: p.id,
    name: p.name,
    avatarUrl: p.avatarUrl,
    side: p.side,
    points: p.points,
    bestStreak: p.bestStreak,
    impact: p.impact,
    accuracy: accuracy(p),
  }));

  return {
    matchId: args.matchId ?? MATCH_ID,
    score,
    winningSide,
    raidWinner,
    finalFanPower: fanPower,
    totalImpact,
    top10,
    players: playerSummaries,
    answersLogSha256: hashAnswerLog(answers),
    chainSignature: null,
  };
}
