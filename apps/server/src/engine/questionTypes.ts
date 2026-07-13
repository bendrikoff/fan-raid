import {
  QUESTION,
  TEAM_NAMES,
  type MatchEvent,
  type Probs,
  type QuestionTypeId,
  type TeamSide,
} from '@fan-raid/shared';

type TeamNames = Record<TeamSide, string>;

// Question resolve attempt result.
export type ResolveOutcome =
  | { status: 'pending' }
  | { status: 'resolved'; correctIndex: number }
  | { status: 'void' };

// Resolve context. All windows are counted from lockedMinute (anti-latency, section 7.1).
export interface ResolutionContext {
  lockedMinute: number;
  currentMinute: number;
  // Events that happened AFTER locking, in chronological order.
  eventsSinceLock: MatchEvent[];
  // Probabilities by minute (latest known snapshot at or before minute).
  oddsAt: (minute: number) => Probs | undefined;
  // Side parameter (PROB_DELTA, NEXT_DANGER_TEAM).
  team?: TeamSide;
}

export interface QuestionDef {
  typeId: QuestionTypeId;
  text: string;
  options: string[];
  isBonus: boolean;
  team?: TeamSide;
}

// --- Helpers --------------------------------------------------------------

function firstEvent(
  events: MatchEvent[],
  pred: (e: MatchEvent) => boolean,
): MatchEvent | undefined {
  return events.find(pred);
}

function halftimeOrFulltime(events: MatchEvent[]): MatchEvent | undefined {
  return events.find((e) => e.type === 'halftime' || e.type === 'fulltime');
}

function fulltimeReached(events: MatchEvent[]): boolean {
  return events.some((e) => e.type === 'fulltime');
}

// --- Resolvers (section 7.2 table) ----------------------------------------

// NEXT_EVENT_TYPE: [Shot, Corner, Card].
// First shot/on_target/corner/yellow/red after locked. A goal resolves as "Shot".
function resolveNextEventType(ctx: ResolutionContext): ResolveOutcome {
  const ev = firstEvent(ctx.eventsSinceLock, (e) =>
    ['shot', 'shot_on_target', 'goal', 'corner', 'yellow_card', 'red_card'].includes(e.type),
  );
  if (ev) {
    if (ev.type === 'shot' || ev.type === 'shot_on_target' || ev.type === 'goal') {
      return { status: 'resolved', correctIndex: 0 };
    }
    if (ev.type === 'corner') return { status: 'resolved', correctIndex: 1 };
    return { status: 'resolved', correctIndex: 2 }; // yellow/red
  }
  // Nothing before the end of the half → void.
  if (halftimeOrFulltime(ctx.eventsSinceLock)) return { status: 'void' };
  return { status: 'pending' };
}

// NEXT_DANGER_TEAM: [home, away]. First shot_on_target or corner with a team.
function resolveNextDangerTeam(ctx: ResolutionContext): ResolveOutcome {
  const ev = firstEvent(
    ctx.eventsSinceLock,
    (e) => (e.type === 'shot_on_target' || e.type === 'corner') && e.team !== undefined,
  );
  if (ev && ev.team) {
    return { status: 'resolved', correctIndex: ev.team === 'home' ? 0 : 1 };
  }
  if (halftimeOrFulltime(ctx.eventsSinceLock)) return { status: 'void' };
  return { status: 'pending' };
}

// GOAL_IN_WINDOW: [Yes, No]. Goal in (lockedMinute, lockedMinute+10]?
function resolveGoalInWindow(ctx: ResolutionContext): ResolveOutcome {
  const end = ctx.lockedMinute + QUESTION.GOAL_WINDOW_MINUTES;
  const goal = firstEvent(
    ctx.eventsSinceLock,
    (e) => e.type === 'goal' && e.minute > ctx.lockedMinute && e.minute <= end,
  );
  if (goal) return { status: 'resolved', correctIndex: 0 }; // Yes
  // Window closed without a goal, or the match ended → No.
  if (ctx.currentMinute >= end || fulltimeReached(ctx.eventsSinceLock)) {
    return { status: 'resolved', correctIndex: 1 };
  }
  return { status: 'pending' };
}

// CARD_BEFORE_BREAK: [Yes, No]. Card before the nearest halftime/fulltime?
function resolveCardBeforeBreak(ctx: ResolutionContext): ResolveOutcome {
  for (const e of ctx.eventsSinceLock) {
    if (e.type === 'yellow_card' || e.type === 'red_card') {
      return { status: 'resolved', correctIndex: 0 }; // Yes
    }
    if (e.type === 'halftime' || e.type === 'fulltime') {
      return { status: 'resolved', correctIndex: 1 }; // boundary without a card → No
    }
  }
  return { status: 'pending' };
}

// PROB_DELTA: [Yes, No]. Did probs[team] grow by PROB_DELTA_THRESHOLD over 8 minutes?
function resolveProbDelta(ctx: ResolutionContext): ResolveOutcome {
  const team = ctx.team ?? 'home';
  const end = ctx.lockedMinute + QUESTION.PROB_DELTA_MINUTES;
  const base = ctx.oddsAt(ctx.lockedMinute)?.[team];
  if (base === undefined) {
    // No base snapshot — cannot resolve; void at the match boundary.
    if (fulltimeReached(ctx.eventsSinceLock)) return { status: 'void' };
    return { status: 'pending' };
  }
  const matchOver = fulltimeReached(ctx.eventsSinceLock);
  if (ctx.currentMinute >= end || matchOver) {
    const at = matchOver ? ctx.currentMinute : end;
    const now = ctx.oddsAt(at)?.[team];
    if (now === undefined) return { status: 'pending' };
    const delta = now - base;
    return { status: 'resolved', correctIndex: delta >= QUESTION.PROB_DELTA_THRESHOLD ? 0 : 1 };
  }
  return { status: 'pending' };
}

// CORNER_BONUS (7.3): [Yes, No]. shot_on_target within 2 game minutes?
function resolveCornerBonus(ctx: ResolutionContext): ResolveOutcome {
  const end = ctx.lockedMinute + QUESTION.CORNER_BONUS_RESOLVE_MINUTES;
  const sot = firstEvent(
    ctx.eventsSinceLock,
    (e) => e.type === 'shot_on_target' && e.minute <= end,
  );
  if (sot) return { status: 'resolved', correctIndex: 0 }; // Yes
  if (ctx.currentMinute > end || halftimeOrFulltime(ctx.eventsSinceLock)) {
    return { status: 'resolved', correctIndex: 1 }; // No
  }
  return { status: 'pending' };
}

// --- Type registry --------------------------------------------------------

const RESOLVERS: Record<QuestionTypeId, (ctx: ResolutionContext) => ResolveOutcome> = {
  NEXT_EVENT_TYPE: resolveNextEventType,
  NEXT_DANGER_TEAM: resolveNextDangerTeam,
  GOAL_IN_WINDOW: resolveGoalInWindow,
  CARD_BEFORE_BREAK: resolveCardBeforeBreak,
  PROB_DELTA: resolveProbDelta,
  CORNER_BONUS: resolveCornerBonus,
};

export function resolveQuestion(
  typeId: QuestionTypeId,
  ctx: ResolutionContext,
): ResolveOutcome {
  return RESOLVERS[typeId](ctx);
}

// Build question text/options.
export function buildQuestionDef(typeId: QuestionTypeId, team?: TeamSide, teamNames: TeamNames = TEAM_NAMES): QuestionDef {
  switch (typeId) {
    case 'NEXT_EVENT_TYPE':
      return {
        typeId,
        text: 'What happens next?',
        options: ['Shot', 'Corner', 'Card'],
        isBonus: false,
      };
    case 'NEXT_DANGER_TEAM':
      return {
        typeId,
        text: 'Who creates the next dangerous chance?',
        options: [teamNames.home, teamNames.away],
        isBonus: false,
      };
    case 'GOAL_IN_WINDOW':
      return {
        typeId,
        text: 'Will there be a goal in the next 10 minutes?',
        options: ['Yes', 'No'],
        isBonus: false,
      };
    case 'CARD_BEFORE_BREAK':
      return {
        typeId,
        text: 'Will there be a card before the end of the half?',
        options: ['Yes', 'No'],
        isBonus: false,
      };
    case 'PROB_DELTA': {
      const t = team ?? 'home';
      return {
        typeId,
        team: t,
        text: `Will ${teamNames[t]} win probability rise by 5+ pp in 8 minutes?`,
        options: ['Yes', 'No'],
        isBonus: false,
      };
    }
    case 'CORNER_BONUS':
      return {
        typeId,
        text: 'Will the corner end with a shot on target?',
        options: ['Yes', 'No'],
        isBonus: true,
      };
    default: {
      const _exhaustive: never = typeId;
      throw new Error(`Unknown question type: ${String(_exhaustive)}`);
    }
  }
}
