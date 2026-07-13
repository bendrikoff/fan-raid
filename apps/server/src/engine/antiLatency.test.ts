import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUESTION, type QuestionPublic, type ServerMessage, type TeamSide } from '@fan-raid/shared';
import { Rng } from '../util/rng.js';
import { BaseFeed } from '../feed/FeedSource.js';
import { QuestionEngine } from './QuestionEngine.js';
import { MatchRoom, type RoomBroadcaster } from './MatchRoom.js';

// Anti-latency rule (section 7.1): the answer window closes on locked;
// answers after locked must be rejected (DoD #6).

describe('QuestionEngine: окно ответа закрывается на lock', () => {
  it('isAcceptingAnswers=false после lock', () => {
    const rng = new Rng(1);
    let opened: QuestionPublic | null = null;
    let lockedId: string | null = null;
    const engine = new QuestionEngine(rng, {
      onOpen: (q) => (opened = q),
      onLocked: (id) => (lockedId = id),
      onResolved: () => {},
    });

    engine.update(0, 0, true); // schedule the next question (gap 45..75 gs)
    engine.update(200, 0, true); // create question (open)
    const q = opened as QuestionPublic | null;
    expect(q).not.toBeNull();
    expect(engine.isAcceptingAnswers(q!.id)).toBe(true);

    engine.update(200 + QUESTION.OPEN_GAME_SECONDS, 0, true); // window expired → lock
    expect(lockedId).toBe(q!.id);
    expect(engine.isAcceptingAnswers(q!.id)).toBe(false);
  });
});

class TestFeed extends BaseFeed {
  start(): void {}
  stop(): void {}
  pushKickoff(): void {
    this.emitMatch({ matchId: 'm', ts: 0, minute: 0, type: 'kickoff' });
  }
}

describe('MatchRoom: submitAnswer отклоняется после lock', () => {
  afterEach(() => vi.useRealTimers());

  it('открыт → ответ принят; locked → QUESTION_CLOSED', () => {
    vi.useFakeTimers();
    const broadcast: ServerMessage[] = [];
    const broadcaster: RoomBroadcaster = {
      broadcast: (m) => broadcast.push(m),
      toPlayer: () => {},
    };
    // Slow game clock so the open window spans several ticks.
    const room = new MatchRoom(broadcaster, 50, {}, 7);
    const feed = new TestFeed();
    room.start(feed);
    room.addPlayer('p1', 'P1', 'home' as TeamSide);
    room.addPlayer('p2', 'P2', 'away' as TeamSide);
    feed.pushKickoff();

    const findQuestion = (): QuestionPublic | undefined =>
      broadcast.find((m) => m.type === 'question')?.type === 'question'
        ? (broadcast.find((m) => m.type === 'question') as { payload: QuestionPublic }).payload
        : undefined;
    const isLocked = (id: string): boolean =>
      broadcast.some((m) => m.type === 'question_locked' && m.payload.id === id);

    const advanceUntil = (pred: () => boolean, maxMs = 30000): void => {
      let elapsed = 0;
      while (!pred() && elapsed < maxMs) {
        vi.advanceTimersByTime(100);
        elapsed += 100;
      }
    };

    advanceUntil(() => findQuestion() !== undefined);
    const q = findQuestion();
    expect(q).toBeDefined();
    // While open, answers are accepted.
    expect(room.submitAnswer('p1', q!.id, 0).ok).toBe(true);

    advanceUntil(() => isLocked(q!.id));
    expect(isLocked(q!.id)).toBe(true);
    // After lock, answers are rejected with QUESTION_CLOSED.
    const res = room.submitAnswer('p2', q!.id, 0);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('QUESTION_CLOSED');

    room.stop();
  });
});
