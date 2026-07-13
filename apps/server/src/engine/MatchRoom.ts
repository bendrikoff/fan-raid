import {
  CARD_FANPOWER_SHIFT,
  FAN_POWER,
  MATCH_ID,
  TEAM_NAMES,
  clamp,
  type AnswerRecord,
  type LeaderboardEntry,
  type MatchEvent,
  type MatchPhase,
  type MatchInfo,
  type MatchSummary,
  type OddsUpdate,
  type PlayerPublic,
  type Probs,
  type QuestionPublic,
  type RoomStatePublic,
  type Score,
  type ServerMessage,
  type TeamSide,
} from '@fan-raid/shared';
import type { FeedSource } from '../feed/FeedSource.js';
import { Rng } from '../util/rng.js';
import { computeFanPower, type ScoredAnswer } from './fanPower.js';
import { QuestionEngine } from './QuestionEngine.js';
import { impactForCorrect, pointsForCorrect } from './scoring.js';
import {
  buildMatchSummary,
  type AnswerLogRow,
  type SettlementPlayer,
} from './settlement.js';

interface InternalPlayer {
  id: string;
  name: string;
  avatarUrl?: string;
  side: TeamSide;
  points: number;
  streak: number;
  bestStreak: number;
  impact: number;
  correctCount: number;
  answeredCount: number;
  answers: AnswerRecord[];
}

// External room dependencies (implemented by the WS layer and persist/solana).
export interface RoomBroadcaster {
  broadcast(msg: ServerMessage): void;
  toPlayer(playerId: string, msg: ServerMessage): void;
}

export interface RoomHooks {
  // May return an updated summary (for example, with a Solana transaction signature),
  // which is then broadcast in match_end.
  onMatchEnd?(summary: MatchSummary): void | MatchSummary | Promise<void | MatchSummary>;
  persistAnswer?(row: AnswerLogRow): void;
  // Called after match_end is broadcast and the room is stopped.
  onFinished?(): void;
}

const REAL_TICK_MS = 100;
const DEFAULT_MATCH_INFO: MatchInfo = {
  id: MATCH_ID,
  source: 'sim',
  isReal: false,
  teams: { home: TEAM_NAMES.home, away: TEAM_NAMES.away },
  status: 'live',
};

// One MatchRoom per match (section 6). The server is authoritative for everything.
export class MatchRoom {
  private phase: MatchPhase = 'lobby';
  private minute = 0;
  private gameSeconds = 0;
  private score: Score = { home: 0, away: 0 };
  private probs: Probs = { home: 0.4, draw: 0.26, away: 0.34 };
  private fanPower = 50;
  // Persistent Fan Power shift from cards (not reset by accuracy recalculation).
  private fanPowerBias = 0;

  private players = new Map<string, InternalPlayer>();
  private scoredAnswers: ScoredAnswer[] = [];
  private answerLog: AnswerLogRow[] = [];

  private readonly engine: QuestionEngine;
  private ticker: NodeJS.Timeout | null = null;
  private feed: FeedSource | null = null;
  private ended = false;

  constructor(
    private readonly broadcaster: RoomBroadcaster,
    private readonly gameSecondsPerRealSecond: number,
    private readonly hooks: RoomHooks = {},
    rngSeed?: number,
    private readonly matchInfo: MatchInfo = DEFAULT_MATCH_INFO,
  ) {
    const rng = new Rng(rngSeed);
    this.engine = new QuestionEngine(
      rng,
      {
        onOpen: (q) => this.onQuestionOpen(q),
        onLocked: (id) => this.broadcaster.broadcast({ type: 'question_locked', payload: { id } }),
        onResolved: (q, correctIndex) => this.onQuestionResolved(q, correctIndex),
      },
      this.matchInfo.teams,
    );
  }

  // --- Lifecycle ---------------------------------------------------------

  start(feed: FeedSource): void {
    this.feed = feed;
    feed.on('odds', (u) => this.onOdds(u));
    feed.on('match', (e) => this.onMatchEvent(e));
    this.ticker = setInterval(() => this.realTick(), REAL_TICK_MS);
    feed.start(this.matchInfo.id);
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.feed?.stop();
  }

  private realTick(): void {
    if (this.phase === 'finished') return;
    this.gameSeconds += this.gameSecondsPerRealSecond * (REAL_TICK_MS / 1000);
    const canSchedule = this.phase === 'first_half' || this.phase === 'second_half';
    this.engine.update(this.gameSeconds, this.minute, canSchedule);
  }

  // --- Feed ---------------------------------------------------------------

  private onOdds(u: OddsUpdate): void {
    const prev = this.probs;
    this.minute = u.minute;
    this.probs = u.probs;
    this.engine.onOdds(u);
    // tick once per game minute (SimFeed emits odds every minute).
    this.broadcaster.broadcast({
      type: 'tick',
      payload: {
        minute: this.minute,
        probs: this.probs,
        fanPower: this.fanPower,
        score: this.score,
      },
    });
    void prev;
  }

  private onMatchEvent(e: MatchEvent): void {
    this.minute = e.minute;
    this.applyPhase(e);
    this.applyEventSideEffects(e);
    this.engine.onMatchEvent(e, this.gameSeconds, this.minute);
    // Event for client-side effects (section 9).
    this.broadcaster.broadcast({ type: 'match_event', payload: e });
  }

  private applyPhase(e: MatchEvent): void {
    switch (e.type) {
      case 'kickoff':
        this.setPhase('first_half');
        break;
      case 'halftime':
        this.setPhase('halftime');
        break;
      case 'second_half':
        this.setPhase('second_half');
        break;
      case 'fulltime':
        this.setPhase('finished');
        this.endMatch();
        break;
      default:
        break;
    }
  }

  private setPhase(phase: MatchPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    // Full snapshot on phase transitions (section 10).
    this.broadcastStateToAll();
    if (phase === 'halftime') this.broadcastLeaderboard();
  }

  private applyEventSideEffects(e: MatchEvent): void {
    if (e.type === 'goal' && e.team) {
      this.score[e.team] += 1;
    }
    // A card against one side shifts Fan Power toward the opponent (section 9).
    if (e.type === 'yellow_card' && e.team) {
      this.shiftFanPowerAgainst(e.team, CARD_FANPOWER_SHIFT.yellow);
    }
    if (e.type === 'red_card' && e.team) {
      this.shiftFanPowerAgainst(e.team, CARD_FANPOWER_SHIFT.red);
    }
  }

  // Shift persistent bias against `side` (toward the opponent).
  private shiftFanPowerAgainst(side: TeamSide, amount: number): void {
    this.fanPowerBias += side === 'home' ? -amount : amount;
    this.recomputeFanPower();
  }

  // Fan Power = rolling accuracy (section 8.3) + persistent card bias.
  private recomputeFanPower(): void {
    const base = computeFanPower(this.scoredAnswers, this.minute);
    this.fanPower = clamp(FAN_POWER.MIN, FAN_POWER.MAX, base + this.fanPowerBias);
  }

  // --- Questions ---------------------------------------------------------

  private onQuestionOpen(q: QuestionPublic): void {
    this.broadcaster.broadcast({ type: 'question', payload: q });
  }

  private onQuestionResolved(q: QuestionPublic, correctIndex: number | null): void {
    const isVoid = correctIndex === null;
    for (const p of this.players.values()) {
      const ans = p.answers.find((a) => a.questionId === q.id);
      const result = this.settlePlayer(p, q, correctIndex, ans);
      // Personalized result for each player (section 10).
      this.broadcaster.toPlayer(p.id, {
        type: 'question_resolved',
        payload: {
          id: q.id,
          correctIndex,
          yourResult: result.result,
          pointsDelta: result.pointsDelta,
          impactDelta: result.impactDelta,
          streak: p.streak,
        },
      });
    }
    // Recalculate Fan Power on every resolve (section 8.3).
    this.recomputeFanPower();
    void isVoid;
    this.broadcastLeaderboard();
  }

  private settlePlayer(
    p: InternalPlayer,
    q: QuestionPublic,
    correctIndex: number | null,
    ans: AnswerRecord | undefined,
  ): { result: 'correct' | 'wrong' | 'missed' | 'void'; pointsDelta: number; impactDelta: number } {
    // Void: no consequences, streaks are preserved (section 7.2).
    if (correctIndex === null) {
      if (ans) ans.result = 'void';
      return { result: 'void', pointsDelta: 0, impactDelta: 0 };
    }
    // Miss: no consequences, streak is preserved (section 8.2).
    if (!ans) {
      return { result: 'missed', pointsDelta: 0, impactDelta: 0 };
    }

    const correct = ans.optionIndex === correctIndex;
    // Accuracy and Fan Power count only actually answered questions.
    p.answeredCount += 1;
    this.scoredAnswers.push({ minute: this.minute, side: p.side, correct });

    if (!correct) {
      ans.result = 'wrong';
      if (!q.isBonus) p.streak = 0; // wrong: streak resets (bonus questions do not, 7.3)
      return { result: 'wrong', pointsDelta: 0, impactDelta: 0 };
    }

    // Correct answer.
    ans.result = 'correct';
    p.correctCount += 1;
    let effectiveStreak: number;
    if (q.isBonus) {
      // Bonus: streak neither grows nor resets; reward uses the current streak.
      effectiveStreak = Math.max(1, p.streak);
    } else {
      p.streak += 1; // streak grows (section 8.1)
      effectiveStreak = p.streak;
    }
    if (p.streak > p.bestStreak) p.bestStreak = p.streak;

    const pointsDelta = pointsForCorrect(effectiveStreak);
    const impactDelta = impactForCorrect(effectiveStreak);
    p.points += pointsDelta;
    p.impact += impactDelta;

    return { result: 'correct', pointsDelta, impactDelta };
  }

  // --- Players -----------------------------------------------------------

  addPlayer(id: string, name: string, side: TeamSide, avatarUrl?: string): InternalPlayer {
    let p = this.players.get(id);
    if (!p) {
      p = {
        id,
        name,
        avatarUrl,
        side,
        points: 0,
        streak: 0,
        bestStreak: 0,
        impact: 0,
        correctCount: 0,
        answeredCount: 0,
        answers: [],
      };
      this.players.set(id, p);
    } else if (avatarUrl && p.avatarUrl !== avatarUrl) {
      p.avatarUrl = avatarUrl;
    }
    return p;
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  updatePlayerProfile(id: string, name: string, avatarUrl?: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.name = name;
    p.avatarUrl = avatarUrl;
  }

  // Side selection is allowed once per match; switching is forbidden (section 6).
  pickSide(id: string, side: TeamSide): { ok: boolean; code?: string } {
    const p = this.players.get(id);
    if (!p) return { ok: false, code: 'BAD_TOKEN' };
    if (p.side !== side && (p.points > 0 || p.answers.length > 0)) {
      return { ok: false, code: 'SIDE_LOCKED' };
    }
    p.side = side;
    return { ok: true };
  }

  // Answer intake. Anti-latency: accepted only while the question is in the open phase.
  submitAnswer(
    id: string,
    questionId: string,
    optionIndex: number,
  ): { ok: boolean; code?: string } {
    const p = this.players.get(id);
    if (!p) return { ok: false, code: 'BAD_TOKEN' };
    const active = this.engine.activeQuestion;
    if (!active || active.id !== questionId) return { ok: false, code: 'NO_ACTIVE_QUESTION' };
    if (!this.engine.isAcceptingAnswers(questionId)) {
      return { ok: false, code: 'QUESTION_CLOSED' };
    }
    if (p.answers.some((a) => a.questionId === questionId)) {
      return { ok: false, code: 'ALREADY_ANSWERED' };
    }
    if (optionIndex < 0 || optionIndex >= active.options.length) {
      return { ok: false, code: 'BAD_MESSAGE' };
    }
    const rec: AnswerRecord = { questionId, optionIndex, result: 'pending', ts: Date.now() };
    p.answers.push(rec);
    this.answerLog.push({
      playerId: p.id,
      questionId,
      option: optionIndex,
      result: 'pending',
      ts: rec.ts,
    });
    this.hooks.persistAnswer?.({ ...this.answerLog[this.answerLog.length - 1]! });
    return { ok: true };
  }

  // --- Snapshots and broadcast -------------------------------------------

  private toPublicPlayer(p: InternalPlayer): PlayerPublic {
    return {
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      side: p.side,
      points: p.points,
      streak: p.streak,
      bestStreak: p.bestStreak,
      impact: p.impact,
    };
  }

  snapshotFor(playerId?: string): RoomStatePublic {
    const players = [...this.players.values()].map((p) => this.toPublicPlayer(p));
    const state: RoomStatePublic = {
      matchId: this.matchInfo.id,
      match: this.matchInfo,
      phase: this.phase,
      minute: this.minute,
      score: this.score,
      probs: this.probs,
      fanPower: this.fanPower,
      activeQuestion: this.engine.activeQuestion,
      players,
    };
    if (playerId) {
      const me = this.players.get(playerId);
      if (me) state.you = this.toPublicPlayer(me);
    }
    return state;
  }

  private broadcastStateToAll(): void {
    for (const p of this.players.values()) {
      this.broadcaster.toPlayer(p.id, { type: 'state', payload: this.snapshotFor(p.id) });
    }
  }

  private leaderboardTop(limit: number): LeaderboardEntry[] {
    return [...this.players.values()]
      .sort((a, b) => b.points - a.points)
      .slice(0, limit)
      .map((p) => ({ playerId: p.id, name: p.name, avatarUrl: p.avatarUrl, side: p.side, points: p.points }));
  }

  private broadcastLeaderboard(): void {
    const sorted = [...this.players.values()].sort((a, b) => b.points - a.points);
    const top = sorted.slice(0, 10).map((p) => ({ playerId: p.id, name: p.name, avatarUrl: p.avatarUrl, side: p.side, points: p.points }));
    for (const p of this.players.values()) {
      const rank = sorted.findIndex((x) => x.id === p.id);
      this.broadcaster.toPlayer(p.id, {
        type: 'leaderboard',
        payload: { top, yourRank: rank >= 0 ? rank + 1 : null },
      });
    }
  }

  // --- Match result ------------------------------------------------------

  private endMatch(): void {
    if (this.ended) return;
    this.ended = true;
    void this.finalize(this.buildSummary());
  }

  private async finalize(summary: MatchSummary): Promise<void> {
    let finalSummary = summary;
    try {
      const updated = await this.hooks.onMatchEnd?.(summary);
      if (updated) finalSummary = updated;
    } catch (err) {
      console.error('[room] onMatchEnd failed:', err);
    }
    // match_end is broadcast after the result is committed (including on-chain).
    this.broadcaster.broadcast({ type: 'match_end', payload: { summary: finalSummary } });
    this.stop();
    this.hooks.onFinished?.();
  }

  buildSummary(): MatchSummary {
    const players: SettlementPlayer[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      side: p.side,
      points: p.points,
      bestStreak: p.bestStreak,
      impact: p.impact,
      correctCount: p.correctCount,
      answeredCount: p.answeredCount,
    }));
    return buildMatchSummary({
      matchId: this.matchInfo.id,
      score: this.score,
      fanPower: this.fanPower,
      players,
      answers: this.answerLog,
    });
  }

  // Access for tests/diagnostics.
  get currentPhase(): MatchPhase {
    return this.phase;
  }

  get topLeaderboard(): LeaderboardEntry[] {
    return this.leaderboardTop(50);
  }
}
