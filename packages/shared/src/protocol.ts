// ---------------------------------------------------------------------------
// Fan Raid — WebSocket protocol (design doc section 10).
// Single endpoint: ws://server/ws. All messages are JSON { type, payload }.
// The server is authoritative for everything; the client only renders and sends choices.
// ---------------------------------------------------------------------------

import type {
  AnswerResult,
  LeaderboardEntry,
  MatchEvent,
  MatchSummary,
  Probs,
  QuestionPublic,
  RoomStatePublic,
  Score,
  TeamSide,
} from './types.js';

// --- Client → server ------------------------------------------------------

export interface JoinMsg {
  type: 'join';
  payload: { token: string; side?: TeamSide };
}

export interface PickSideMsg {
  type: 'pick_side';
  payload: { side: TeamSide };
}

export interface AnswerMsg {
  type: 'answer';
  payload: { questionId: string; optionIndex: number };
}

export interface PingMsg {
  type: 'ping';
  payload?: Record<string, never>;
}

export type ClientMessage = JoinMsg | PickSideMsg | AnswerMsg | PingMsg;

// --- Server → client ------------------------------------------------------

export interface StateMsg {
  type: 'state';
  payload: RoomStatePublic;
}

export interface TickMsg {
  type: 'tick';
  payload: {
    minute: number;
    probs: Probs;
    fanPower: number;
    score: Score;
  };
}

export interface MatchEventMsg {
  type: 'match_event';
  payload: MatchEvent;
}

export interface QuestionMsg {
  type: 'question';
  payload: QuestionPublic;
}

export interface QuestionLockedMsg {
  type: 'question_locked';
  payload: { id: string };
}

export interface QuestionResolvedMsg {
  type: 'question_resolved';
  payload: {
    id: string;
    correctIndex: number | null; // null for void
    yourResult: AnswerResult;
    pointsDelta: number;
    impactDelta: number;
    streak: number;
  };
}

export interface LeaderboardMsg {
  type: 'leaderboard';
  payload: {
    top: LeaderboardEntry[];
    yourRank: number | null;
  };
}

export interface MatchEndMsg {
  type: 'match_end';
  payload: { summary: MatchSummary };
}

export interface PongMsg {
  type: 'pong';
  payload?: Record<string, never>;
}

export interface ErrorMsg {
  type: 'error';
  payload: { code: string; message: string };
}

export type ServerMessage =
  | StateMsg
  | TickMsg
  | MatchEventMsg
  | QuestionMsg
  | QuestionLockedMsg
  | QuestionResolvedMsg
  | LeaderboardMsg
  | MatchEndMsg
  | PongMsg
  | ErrorMsg;

// Protocol error codes.
export const ErrorCode = {
  BAD_TOKEN: 'BAD_TOKEN',
  BAD_MESSAGE: 'BAD_MESSAGE',
  SIDE_LOCKED: 'SIDE_LOCKED',
  QUESTION_CLOSED: 'QUESTION_CLOSED',
  NO_ACTIVE_QUESTION: 'NO_ACTIVE_QUESTION',
  ALREADY_ANSWERED: 'ALREADY_ANSWERED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
