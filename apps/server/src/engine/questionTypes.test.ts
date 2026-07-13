import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchEventType, Probs, TeamSide } from '@fan-raid/shared';
import { resolveQuestion, type ResolutionContext } from './questionTypes.js';

function ev(type: MatchEventType, minute: number, team?: TeamSide): MatchEvent {
  const e: MatchEvent = { matchId: 'm', ts: minute * 1000, minute, type };
  if (team) e.team = team;
  return e;
}

function ctx(over: Partial<ResolutionContext>): ResolutionContext {
  return {
    lockedMinute: 10,
    currentMinute: 10,
    eventsSinceLock: [],
    oddsAt: () => undefined,
    ...over,
  };
}

describe('NEXT_EVENT_TYPE', () => {
  it('гол резолвит как «Удар» (index 0)', () => {
    const r = resolveQuestion('NEXT_EVENT_TYPE', ctx({ eventsSinceLock: [ev('goal', 11, 'home')] }));
    expect(r).toEqual({ status: 'resolved', correctIndex: 0 });
  });
  it('угловой → index 1', () => {
    const r = resolveQuestion('NEXT_EVENT_TYPE', ctx({ eventsSinceLock: [ev('corner', 11, 'away')] }));
    expect(r).toEqual({ status: 'resolved', correctIndex: 1 });
  });
  it('жёлтая → index 2 (карточка)', () => {
    const r = resolveQuestion('NEXT_EVENT_TYPE', ctx({ eventsSinceLock: [ev('yellow_card', 11, 'away')] }));
    expect(r).toEqual({ status: 'resolved', correctIndex: 2 });
  });
  it('первое релевантное событие выигрывает', () => {
    const r = resolveQuestion(
      'NEXT_EVENT_TYPE',
      ctx({ eventsSinceLock: [ev('corner', 11), ev('shot', 12)] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 1 });
  });
  it('void, если до halftime ничего не произошло', () => {
    const r = resolveQuestion('NEXT_EVENT_TYPE', ctx({ eventsSinceLock: [ev('halftime', 45)] }));
    expect(r).toEqual({ status: 'void' });
  });
  it('pending, пока событие не наступило', () => {
    const r = resolveQuestion('NEXT_EVENT_TYPE', ctx({ eventsSinceLock: [] }));
    expect(r).toEqual({ status: 'pending' });
  });
});

describe('NEXT_DANGER_TEAM', () => {
  it('shot_on_target home → index 0', () => {
    const r = resolveQuestion(
      'NEXT_DANGER_TEAM',
      ctx({ eventsSinceLock: [ev('shot_on_target', 11, 'home')] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 0 });
  });
  it('corner away → index 1', () => {
    const r = resolveQuestion(
      'NEXT_DANGER_TEAM',
      ctx({ eventsSinceLock: [ev('shot', 11, 'home'), ev('corner', 12, 'away')] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 1 });
  });
  it('void на конце тайма без опасного момента', () => {
    const r = resolveQuestion('NEXT_DANGER_TEAM', ctx({ eventsSinceLock: [ev('fulltime', 90)] }));
    expect(r).toEqual({ status: 'void' });
  });
});

describe('GOAL_IN_WINDOW', () => {
  it('гол в окне → Да (0)', () => {
    const r = resolveQuestion(
      'GOAL_IN_WINDOW',
      ctx({ lockedMinute: 10, currentMinute: 12, eventsSinceLock: [ev('goal', 12, 'home')] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 0 });
  });
  it('окно закрылось без гола → Нет (1)', () => {
    const r = resolveQuestion(
      'GOAL_IN_WINDOW',
      ctx({ lockedMinute: 10, currentMinute: 20, eventsSinceLock: [] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 1 });
  });
  it('гол за пределами окна не считается', () => {
    const r = resolveQuestion(
      'GOAL_IN_WINDOW',
      ctx({ lockedMinute: 10, currentMinute: 21, eventsSinceLock: [ev('goal', 21, 'home')] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 1 });
  });
  it('pending, пока окно открыто и гола нет', () => {
    const r = resolveQuestion(
      'GOAL_IN_WINDOW',
      ctx({ lockedMinute: 10, currentMinute: 15, eventsSinceLock: [] }),
    );
    expect(r).toEqual({ status: 'pending' });
  });
});

describe('CARD_BEFORE_BREAK', () => {
  it('карточка до перерыва → Да (0)', () => {
    const r = resolveQuestion(
      'CARD_BEFORE_BREAK',
      ctx({ eventsSinceLock: [ev('shot', 11), ev('yellow_card', 12, 'home')] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 0 });
  });
  it('перерыв без карточки → Нет (1)', () => {
    const r = resolveQuestion(
      'CARD_BEFORE_BREAK',
      ctx({ eventsSinceLock: [ev('shot', 11), ev('halftime', 45)] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 1 });
  });
});

describe('PROB_DELTA', () => {
  const odds = (m: number): Probs => {
    const map: Record<number, Probs> = {
      10: { home: 0.4, draw: 0.26, away: 0.34 },
      18: { home: 0.47, draw: 0.23, away: 0.3 }, // +7 pp home
    };
    return map[m] ?? map[10]!;
  };
  it('рост ≥ 5 п.п. → Да (0)', () => {
    const r = resolveQuestion(
      'PROB_DELTA',
      ctx({ lockedMinute: 10, currentMinute: 18, team: 'home', oddsAt: odds }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 0 });
  });
  it('рост < 5 п.п. → Нет (1)', () => {
    const r = resolveQuestion(
      'PROB_DELTA',
      ctx({ lockedMinute: 10, currentMinute: 18, team: 'away', oddsAt: odds }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 1 });
  });
  it('pending до истечения 8 минут', () => {
    const r = resolveQuestion(
      'PROB_DELTA',
      ctx({ lockedMinute: 10, currentMinute: 14, team: 'home', oddsAt: odds }),
    );
    expect(r).toEqual({ status: 'pending' });
  });
});

describe('CORNER_BONUS', () => {
  it('удар в створ в 2 минуты → Да (0)', () => {
    const r = resolveQuestion(
      'CORNER_BONUS',
      ctx({ lockedMinute: 10, currentMinute: 11, eventsSinceLock: [ev('shot_on_target', 11, 'home')] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 0 });
  });
  it('нет удара в створ за 2 минуты → Нет (1)', () => {
    const r = resolveQuestion(
      'CORNER_BONUS',
      ctx({ lockedMinute: 10, currentMinute: 13, eventsSinceLock: [] }),
    );
    expect(r).toEqual({ status: 'resolved', correctIndex: 1 });
  });
});
