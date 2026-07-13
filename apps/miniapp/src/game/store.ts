import { useSyncExternalStore } from 'react';
import {
  PROB_JUMP_TOAST_THRESHOLD,
  type LeaderboardEntry,
  type MatchEvent,
  type MatchSummary,
  type PlayerAchievement,
  type Probs,
  type QuestionPublic,
  type RoomStatePublic,
  type Score,
  type ServerMessage,
  type TeamSide,
} from '@fan-raid/shared';

export interface ResolvedFeedback {
  question: QuestionPublic;
  pickedIndex: number | null;
  correctIndex: number | null;
  yourResult: 'correct' | 'wrong' | 'missed' | 'void';
  pointsDelta: number;
  impactDelta: number;
  streak: number;
}

export interface Toast {
  id: number;
  text: string;
  kind?: 'achievement';
  title?: string;
  detail?: string;
  image?: string;
}

export interface FxEvent {
  seq: number;
  event: MatchEvent;
}

export type RoomChannel = 'live' | 'test';

// LIVE event feed entry (with the score snapshot at event time).
export interface FeedItem {
  id: number;
  event: MatchEvent;
  score: Score;
}

export interface ClientState {
  status: 'connecting' | 'connected' | 'disconnected';
  room: RoomStatePublic | null;
  question: QuestionPublic | null;
  questionLocked: boolean;
  answeredOptionIndex: number | null;
  lastResolved: ResolvedFeedback | null;
  leaderboard: { top: LeaderboardEntry[]; yourRank: number | null } | null;
  summary: MatchSummary | null;
  feed: FeedItem[];
  fx: FxEvent | null;
  toasts: Toast[];
  // Estimated real ms per game minute (from tick cadence) — used by the question timer.
  msPerGameMinute: number;
}

const initialState: ClientState = {
  status: 'connecting',
  room: null,
  question: null,
  questionLocked: false,
  answeredOptionIndex: null,
  lastResolved: null,
  leaderboard: null,
  summary: null,
  feed: [],
  fx: null,
  toasts: [],
  msPerGameMinute: 3000,
};

class GameStore {
  private state: ClientState = initialState;
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private roomChannel: RoomChannel = 'live';
  private fxSeq = 0;
  private toastSeq = 0;
  private reconnectTimer: number | null = null;
  private prevProbs: Probs | null = null;
  private lastTickWall = 0;
  private lastTickMinute = -1;

  // --- React glue ---------------------------------------------------------
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): ClientState => this.state;

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // --- Connection --------------------------------------------------------
  connect(token?: string | null, roomChannel: RoomChannel = 'live'): void {
    this.token = token ?? null;
    const switchingRoom = this.roomChannel !== roomChannel;
    this.roomChannel = roomChannel;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.onclose = null;
      this.ws.close();
    }
    if (switchingRoom) this.resetMatchState();
    this.open();
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?room=${this.roomChannel}`);
    this.ws = ws;
    this.set({ status: 'connecting' });

    ws.onopen = () => {
      this.set({ status: 'connected' });
      if (this.token) this.send({ type: 'join', payload: { token: this.token } });
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data as string) as ServerMessage);
    ws.onclose = () => {
      this.set({ status: 'disconnected' });
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  // Reconnect restores state from the state snapshot (DoD #8).
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, 1500);
  }

  private resetMatchState(): void {
    this.prevProbs = null;
    this.lastTickWall = 0;
    this.lastTickMinute = -1;
    this.feedSeq = 0;
    this.set({
      status: 'connecting',
      room: null,
      question: null,
      questionLocked: false,
      answeredOptionIndex: null,
      lastResolved: null,
      leaderboard: null,
      summary: null,
      feed: [],
      fx: null,
      msPerGameMinute: 3000,
    });
  }

  private send(msg: { type: string; payload: unknown }): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  pickSide(side: TeamSide): void {
    if (!this.token) {
      this.toast('Sign in to pick a side');
      return;
    }
    this.send({ type: 'pick_side', payload: { side } });
  }

  answer(questionId: string, optionIndex: number): void {
    if (!this.token) {
      this.toast('Sign in to answer');
      return;
    }
    this.set({ answeredOptionIndex: optionIndex });
    this.send({ type: 'answer', payload: { questionId, optionIndex } });
  }

  // Public toast trigger (used by UI navigation).
  toast(text: string): void {
    this.pushToast({ text });
  }

  achievementToast(achievement: PlayerAchievement): void {
    this.pushToast(
      {
        text: `Achievement unlocked: ${achievement.title}`,
        kind: 'achievement',
        title: achievement.title,
        detail: achievement.detail,
        image: achievement.image,
      },
      4200,
    );
  }

  private pushToast(input: Omit<Toast, 'id'>, timeoutMs = 2600): void {
    const toast: Toast = { id: ++this.toastSeq, ...input };
    this.set({ toasts: [...this.state.toasts, toast] });
    window.setTimeout(() => {
      this.set({ toasts: this.state.toasts.filter((t) => t.id !== toast.id) });
    }, timeoutMs);
  }

  private feedSeq = 0;
  // Meaningful event types shown in the LIVE event feed.
  private static FEED_TYPES = new Set<MatchEvent['type']>([
    'goal', 'yellow_card', 'red_card', 'shot_on_target', 'corner', 'kickoff',
    'halftime', 'second_half', 'fulltime',
  ]);

  private triggerFx(event: MatchEvent): void {
    const patch: Partial<ClientState> = { fx: { seq: ++this.fxSeq, event } };
    if (GameStore.FEED_TYPES.has(event.type)) {
      const base = this.state.room?.score ?? { home: 0, away: 0 };
      // The goal is not in room.score yet (it arrives with tick) — account for it optimistically.
      const score: Score =
        event.type === 'goal' && event.team
          ? { ...base, [event.team]: base[event.team] + 1 }
          : { ...base };
      const item: FeedItem = { id: ++this.feedSeq, event, score };
      patch.feed = [item, ...this.state.feed].slice(0, 8);
    }
    this.set(patch);
  }

  // --- Server message handling -------------------------------------------
  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'state': {
        const room = msg.payload;
        const q = room.activeQuestion;
        const patch: Partial<ClientState> = { room, question: q };
        if (q && q.id !== this.state.question?.id) {
          patch.answeredOptionIndex = null;
          patch.questionLocked = false;
        }
        this.prevProbs = room.probs;
        this.set(patch);
        break;
      }
      case 'tick': {
        const room = this.state.room;
        this.measureCadence(msg.payload.minute);
        if (room) {
          this.maybeProbJumpToast(room.probs, msg.payload.probs);
          this.set({
            room: {
              ...room,
              minute: msg.payload.minute,
              probs: msg.payload.probs,
              fanPower: msg.payload.fanPower,
              score: msg.payload.score,
            },
          });
        }
        break;
      }
      case 'match_event':
        this.triggerFx(msg.payload);
        break;
      case 'question':
        this.set({
          question: msg.payload,
          questionLocked: false,
          answeredOptionIndex: null,
          lastResolved: null,
        });
        break;
      case 'question_locked':
        if (this.state.question?.id === msg.payload.id) this.set({ questionLocked: true });
        break;
      case 'question_resolved': {
        const q = this.state.question;
        if (q && q.id === msg.payload.id) {
          const patch: Partial<ClientState> = {
            lastResolved: {
              question: q,
              pickedIndex: this.state.answeredOptionIndex,
              correctIndex: msg.payload.correctIndex,
              yourResult: msg.payload.yourResult,
              pointsDelta: msg.payload.pointsDelta,
              impactDelta: msg.payload.impactDelta,
              streak: msg.payload.streak,
            },
            question: null,
            questionLocked: false,
          };
          // Live update of personal metrics from personalized deltas.
          const room = this.state.room;
          if (room?.you) {
            const you = {
              ...room.you,
              points: room.you.points + msg.payload.pointsDelta,
              impact: room.you.impact + msg.payload.impactDelta,
              streak: msg.payload.streak,
              bestStreak: Math.max(room.you.bestStreak, msg.payload.streak),
            };
            patch.room = { ...room, you };
          }
          this.set(patch);
        }
        break;
      }
      case 'leaderboard':
        this.set({ leaderboard: msg.payload });
        break;
      case 'match_end':
        this.set({ summary: msg.payload.summary });
        break;
      case 'error':
        this.pushToast({ text: `Error: ${msg.payload.message}` });
        break;
      case 'pong':
      default:
        break;
    }
  }

  // Estimate ms per game minute from tick cadence (EMA).
  private measureCadence(minute: number): void {
    const now = performance.now();
    if (this.lastTickMinute >= 0 && minute > this.lastTickMinute) {
      const perMinute = (now - this.lastTickWall) / (minute - this.lastTickMinute);
      if (perMinute > 200 && perMinute < 60000) {
        const ema = this.state.msPerGameMinute * 0.6 + perMinute * 0.4;
        this.set({ msPerGameMinute: ema });
      }
    }
    this.lastTickWall = now;
    this.lastTickMinute = minute;
  }

  private maybeProbJumpToast(prev: Probs, next: Probs): void {
    const d = Math.max(
      Math.abs(next.home - prev.home),
      Math.abs(next.draw - prev.draw),
      Math.abs(next.away - prev.away),
    );
    if (d >= PROB_JUMP_TOAST_THRESHOLD) this.pushToast({ text: 'Market pressure changed' });
  }
}

export const store = new GameStore();

export function useGame(): ClientState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
