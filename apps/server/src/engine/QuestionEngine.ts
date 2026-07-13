import {
  QUESTION,
  ROTATING_QUESTION_TYPES,
  type MatchEvent,
  type OddsUpdate,
  type Probs,
  type QuestionPublic,
  type QuestionTypeId,
  type TeamSide,
} from '@fan-raid/shared';
import { Rng } from '../util/rng.js';
import {
  buildQuestionDef,
  resolveQuestion,
  type ResolutionContext,
} from './questionTypes.js';

export interface QuestionEngineCallbacks {
  onOpen(q: QuestionPublic): void;
  onLocked(id: string): void;
  // correctIndex === null means void.
  onResolved(q: QuestionPublic, correctIndex: number | null): void;
}

type TeamNames = Record<TeamSide, string>;

interface EngineQuestion {
  pub: QuestionPublic;
  typeId: QuestionTypeId;
  team?: TeamSide;
  isBonus: boolean;
  createdAtSec: number;
  opensUntilSec: number;
  lockedMinute: number | null;
  eventsSinceLock: MatchEvent[];
  phase: 'open' | 'locked';
}

// QuestionEngine (section 7): a room can have at most one active question.
// Time is provided externally (gameSeconds is the fine-grained window clock; feedMinute comes from the feed),
// which keeps the engine deterministic and testable.
export class QuestionEngine {
  private active: EngineQuestion | null = null;
  private nextQuestionAtSec: number | null = null;
  private lastTypeId: QuestionTypeId | null = null;
  private seq = 0;

  // Probability snapshots by minute (for PROB_DELTA).
  private oddsByMinute = new Map<number, Probs>();
  private oddsMinutes: number[] = [];

  constructor(
    private readonly rng: Rng,
    private readonly cb: QuestionEngineCallbacks,
    private readonly teamNames?: TeamNames,
  ) {}

  get activeQuestion(): QuestionPublic | null {
    return this.active?.pub ?? null;
  }

  // Whether the active question currently accepts answers (open phase).
  isAcceptingAnswers(questionId: string): boolean {
    return this.active !== null && this.active.pub.id === questionId && this.active.phase === 'open';
  }

  reset(): void {
    this.active = null;
    this.nextQuestionAtSec = null;
    this.lastTypeId = null;
    this.oddsByMinute.clear();
    this.oddsMinutes = [];
  }

  onOdds(u: OddsUpdate): void {
    if (!this.oddsByMinute.has(u.minute)) this.oddsMinutes.push(u.minute);
    this.oddsByMinute.set(u.minute, { ...u.probs });
  }

  private oddsAt(minute: number): Probs | undefined {
    if (this.oddsByMinute.has(minute)) return this.oddsByMinute.get(minute);
    // Latest known snapshot at or before minute.
    let best: number | undefined;
    for (const m of this.oddsMinutes) {
      if (m <= minute && (best === undefined || m > best)) best = m;
    }
    return best === undefined ? undefined : this.oddsByMinute.get(best);
  }

  // Feed event. Resolves the active locked question and spawns a corner bonus.
  onMatchEvent(e: MatchEvent, gameSeconds: number, feedMinute: number): void {
    if (this.active && this.active.phase === 'locked') {
      this.active.eventsSinceLock.push(e);
      this.tryResolve(feedMinute);
    }
    // Corner bonus only appears OUTSIDE an active question (section 7.3).
    if (e.type === 'corner' && this.active === null) {
      this.spawnBonus(gameSeconds, feedMinute);
    }
  }

  // Engine tick: window closing, deadline resolve, next-question scheduling.
  update(gameSeconds: number, feedMinute: number, canSchedule: boolean): void {
    if (this.active) {
      if (this.active.phase === 'open' && gameSeconds >= this.active.opensUntilSec) {
        this.lock(feedMinute);
      }
      if (this.active && this.active.phase === 'locked') {
        this.tryResolve(feedMinute);
      }
      return;
    }
    // No active question — schedule the next one.
    if (!canSchedule) return;
    if (this.nextQuestionAtSec === null) {
      this.scheduleNext(gameSeconds);
      return;
    }
    if (gameSeconds >= this.nextQuestionAtSec) {
      this.createQuestion(gameSeconds, feedMinute);
    }
  }

  private scheduleNext(fromSec: number): void {
    const gap = this.rng.range(QUESTION.GAP_MIN_GAME_SECONDS, QUESTION.GAP_MAX_GAME_SECONDS);
    this.nextQuestionAtSec = fromSec + gap;
  }

  private pickTypeId(): QuestionTypeId {
    // PROB_DELTA is always available; event questions rotate without repeating the previous type.
    const rotating = ROTATING_QUESTION_TYPES.filter((t) => t !== this.lastTypeId);
    const candidates: QuestionTypeId[] = ['PROB_DELTA', ...rotating];
    return this.rng.pick(candidates);
  }

  private createQuestion(gameSeconds: number, feedMinute: number): void {
    const typeId = this.pickTypeId();
    const team: TeamSide | undefined = typeId === 'PROB_DELTA'
      ? this.rng.pick<TeamSide>(['home', 'away'])
      : undefined;
    this.lastTypeId = typeId;
    this.startQuestion(typeId, team, QUESTION.OPEN_GAME_SECONDS, gameSeconds, feedMinute, false);
  }

  private spawnBonus(gameSeconds: number, feedMinute: number): void {
    this.startQuestion('CORNER_BONUS', undefined, QUESTION.CORNER_BONUS_GAME_SECONDS, gameSeconds, feedMinute, true);
  }

  private startQuestion(
    typeId: QuestionTypeId,
    team: TeamSide | undefined,
    openSeconds: number,
    gameSeconds: number,
    feedMinute: number,
    isBonus: boolean,
  ): void {
    const def = buildQuestionDef(typeId, team, this.teamNames);
    const id = `q${++this.seq}`;
    const closesAtMinute = feedMinute + openSeconds / 60;
    const pub: QuestionPublic = {
      id,
      typeId,
      text: def.text,
      options: def.options,
      createdAtMinute: feedMinute,
      closesAtMinute,
      isBonus,
    };
    this.active = {
      pub,
      typeId,
      team: def.team,
      isBonus,
      createdAtSec: gameSeconds,
      opensUntilSec: gameSeconds + openSeconds,
      lockedMinute: null,
      eventsSinceLock: [],
      phase: 'open',
    };
    this.nextQuestionAtSec = null;
    this.cb.onOpen(pub);
  }

  private lock(feedMinute: number): void {
    if (!this.active) return;
    this.active.phase = 'locked';
    this.active.lockedMinute = feedMinute;
    this.cb.onLocked(this.active.pub.id);
  }

  private tryResolve(feedMinute: number): void {
    const q = this.active;
    if (!q || q.phase !== 'locked' || q.lockedMinute === null) return;
    const ctx: ResolutionContext = {
      lockedMinute: q.lockedMinute,
      currentMinute: feedMinute,
      eventsSinceLock: q.eventsSinceLock,
      oddsAt: (m) => this.oddsAt(m),
      team: q.team,
    };
    const outcome = resolveQuestion(q.typeId, ctx);
    if (outcome.status === 'pending') return;
    const correctIndex = outcome.status === 'resolved' ? outcome.correctIndex : null;
    this.active = null;
    this.cb.onResolved(q.pub, correctIndex);
    // After resolving, schedule the next regular question.
    // (The actual gameSeconds value is supplied by the next update through scheduleNext.)
    this.nextQuestionAtSec = null;
  }
}
