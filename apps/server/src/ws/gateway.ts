import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ErrorCode,
  type ClientMessage,
  type ServerMessage,
  type TeamSide,
} from '@fan-raid/shared';
import type { AppConfig } from '../config.js';
import type { MatchRoom, RoomBroadcaster } from '../engine/MatchRoom.js';
import { verifyToken } from '../api/token.js';

export type RoomId = 'live' | 'test';

interface Conn {
  ws: WebSocket;
  roomId: RoomId;
  playerId?: string;
  name?: string;
  avatarUrl?: string;
}

// WebSocket gateway for independent match rooms.
// /ws?room=live connects to the real configured feed, /ws?room=test to local SimFeed.
export class WsGateway {
  private wss: WebSocketServer;
  private conns = new Map<WebSocket, Conn>();
  private byRoomPlayer = new Map<RoomId, Map<string, Set<WebSocket>>>();
  private rooms = new Map<RoomId, MatchRoom>();

  constructor(server: Server, private readonly config: AppConfig) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
  }

  setRoom(roomId: RoomId, room: MatchRoom): void {
    this.rooms.set(roomId, room);
  }

  broadcaster(roomId: RoomId): RoomBroadcaster {
    return {
      broadcast: (msg) => this.broadcastToRoom(roomId, msg),
      toPlayer: (playerId, msg) => this.toPlayerInRoom(roomId, playerId, msg),
    };
  }

  private broadcastToRoom(roomId: RoomId, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const [ws, conn] of this.conns) {
      if (conn.roomId === roomId && ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  }

  private toPlayerInRoom(roomId: RoomId, playerId: string, msg: ServerMessage): void {
    const set = this.byRoomPlayer.get(roomId)?.get(playerId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const roomId = this.roomIdFromRequest(req);
    this.conns.set(ws, { ws, roomId });
    ws.on('message', (raw) => this.onMessage(ws, raw.toString()));
    ws.on('close', () => this.onClose(ws));
    ws.on('error', () => this.onClose(ws));

    const room = this.rooms.get(roomId);
    if (room) this.send(ws, { type: 'state', payload: room.snapshotFor() });
  }

  private onClose(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (conn?.playerId) {
      const roomPlayers = this.byRoomPlayer.get(conn.roomId);
      const set = roomPlayers?.get(conn.playerId);
      set?.delete(ws);
      if (set && set.size === 0) roomPlayers?.delete(conn.playerId);
    }
    this.conns.delete(ws);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private error(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { type: 'error', payload: { code, message } });
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.error(ws, ErrorCode.BAD_MESSAGE, 'invalid JSON');
    }

    const conn = this.conns.get(ws);
    const roomId = conn?.roomId ?? 'live';
    const room = this.rooms.get(roomId);
    if (!room) return this.error(ws, ErrorCode.BAD_MESSAGE, 'match is not running');

    switch (msg.type) {
      case 'join':
        return this.handleJoin(ws, msg.payload, room, roomId);
      case 'pick_side':
        return this.handlePick(ws, msg.payload.side, room, roomId);
      case 'answer':
        return this.handleAnswer(ws, msg.payload.questionId, msg.payload.optionIndex, room);
      case 'ping':
        return this.send(ws, { type: 'pong', payload: {} });
      default:
        return this.error(ws, ErrorCode.BAD_MESSAGE, 'unknown message type');
    }
  }

  private bindPlayer(ws: WebSocket, playerId: string, name: string, avatarUrl?: string): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    conn.playerId = playerId;
    conn.name = name;
    conn.avatarUrl = avatarUrl;

    let roomPlayers = this.byRoomPlayer.get(conn.roomId);
    if (!roomPlayers) {
      roomPlayers = new Map();
      this.byRoomPlayer.set(conn.roomId, roomPlayers);
    }

    let set = roomPlayers.get(playerId);
    if (!set) {
      set = new Set();
      roomPlayers.set(playerId, set);
    }
    set.add(ws);
  }

  private handleJoin(
    ws: WebSocket,
    payload: { token: string; side?: TeamSide },
    room: MatchRoom,
    roomId: RoomId,
  ): void {
    const session = verifyToken(payload.token, this.config.sessionSecret);
    if (!session) return this.error(ws, ErrorCode.BAD_TOKEN, 'invalid token');
    this.bindPlayer(ws, session.playerId, session.name, session.avatarUrl);
    room.updatePlayerProfile(session.playerId, session.name, session.avatarUrl);

    if (payload.side && !room.hasPlayer(session.playerId)) {
      room.addPlayer(session.playerId, session.name, payload.side, session.avatarUrl);
      this.broadcastState(roomId, room);
    }

    this.send(ws, { type: 'state', payload: room.snapshotFor(session.playerId) });
  }

  private handlePick(ws: WebSocket, side: TeamSide, room: MatchRoom, roomId: RoomId): void {
    const conn = this.conns.get(ws);
    if (!conn?.playerId) return this.error(ws, ErrorCode.BAD_TOKEN, 'join first');

    if (!room.hasPlayer(conn.playerId)) {
      room.addPlayer(conn.playerId, conn.name ?? 'Guest', side, conn.avatarUrl);
    } else {
      const res = room.pickSide(conn.playerId, side);
      if (!res.ok) {
        return this.error(ws, res.code ?? ErrorCode.SIDE_LOCKED, 'side change is locked');
      }
    }

    this.send(ws, { type: 'state', payload: room.snapshotFor(conn.playerId) });
    this.broadcastState(roomId, room);
  }

  private handleAnswer(
    ws: WebSocket,
    questionId: string,
    optionIndex: number,
    room: MatchRoom,
  ): void {
    const conn = this.conns.get(ws);
    if (!conn?.playerId) return this.error(ws, ErrorCode.BAD_TOKEN, 'join first');
    const res = room.submitAnswer(conn.playerId, questionId, optionIndex);
    if (!res.ok) {
      return this.error(ws, res.code ?? ErrorCode.QUESTION_CLOSED, 'answer was not accepted');
    }
  }

  private broadcastState(roomId: RoomId, room: MatchRoom): void {
    const roomPlayers = this.byRoomPlayer.get(roomId);
    if (roomPlayers) {
      for (const playerId of roomPlayers.keys()) {
        this.toPlayerInRoom(roomId, playerId, { type: 'state', payload: room.snapshotFor(playerId) });
      }
    }

    const guestState = JSON.stringify({ type: 'state', payload: room.snapshotFor() } satisfies ServerMessage);
    for (const [ws, conn] of this.conns) {
      if (conn.roomId === roomId && !conn.playerId && ws.readyState === ws.OPEN) {
        ws.send(guestState);
      }
    }
  }

  private roomIdFromRequest(req: IncomingMessage): RoomId {
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    return url.searchParams.get('room') === 'test' ? 'test' : 'live';
  }

  close(): void {
    this.wss.close();
  }
}
