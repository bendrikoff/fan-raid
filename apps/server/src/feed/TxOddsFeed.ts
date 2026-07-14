import WebSocket from 'ws';
import {
  MATCH,
  type MatchEvent,
  type MatchEventType,
  type OddsUpdate,
  type Probs,
  type Score,
  type TeamSide,
} from '@fan-raid/shared';
import { BaseFeed } from './FeedSource.js';

export type TxOddsMode = 'auto' | 'poll' | 'ws' | 'sse';

export interface TxOddsFeedOptions {
  apiUrl: string;
  scoresApiUrl: string;
  apiKey: string;
  bearerToken: string;
  mode: TxOddsMode;
  pollMs: number;
  matchId: string;
  apiKeyHeader: string;
  apiKeyPrefix: string;
  subscribeMessage: string;
  payloadPath: string;
  minutePath: string;
  tsPath: string;
  oddsHomePath: string;
  oddsDrawPath: string;
  oddsAwayPath: string;
  eventTypePath: string;
  eventTeamPath: string;
  homeTeamName: string;
  awayTeamName: string;
}

export interface TxOddsNormalizerOptions {
  matchId: string;
  fallbackMinute: number;
  payloadPath?: string;
  minutePath?: string;
  tsPath?: string;
  oddsHomePath?: string;
  oddsDrawPath?: string;
  oddsAwayPath?: string;
  eventTypePath?: string;
  eventTeamPath?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  externalMatchId?: string;
}

interface NormalizedTxOddsMessage {
  odds: OddsUpdate[];
  events: MatchEvent[];
  scoreSnapshots: NormalizedScoreSnapshot[];
}

interface NormalizedScoreSnapshot {
  matchId: string;
  ts: number;
  minute: number;
  score: Score;
}

interface SseMessage {
  id?: string;
  event?: string;
  data: unknown;
  retry?: number;
}

type JsonObject = Record<string, unknown>;

const EVENT_TYPE_ALIASES: Array<[MatchEventType, string[]]> = [
  [
    'kickoff',
    ['kickoff', 'kick_off', 'started', 'start', 'matchstart', 'match_started', 'firsthalf', 'firsthalfstarted', '1h'],
  ],
  ['halftime', ['halftime', 'half_time', 'ht', 'break', 'firsthalfended']],
  ['second_half', ['secondhalf', 'second_half', 'secondhalfstarted', '2h', 'period2', 'secondperiod']],
  ['fulltime', ['fulltime', 'full_time', 'ft', 'finished', 'ended', 'matchend', 'match_ended', 'matchfinished']],
  ['goal', ['goal', 'goalscore', 'goal_scored', 'scored']],
  ['shot_on_target', ['shotontarget', 'shot_on_target', 'sot', 'on_target', 'shotontargetattempt']],
  ['shot', ['shot', 'attempt']],
  ['corner', ['corner', 'cornerkick', 'corner_kick']],
  ['yellow_card', ['yellowcard', 'yellow_card', 'yc', 'booking', 'cardyellow']],
  ['red_card', ['redcard', 'red_card', 'rc', 'cardred']],
];

const MINUTE_PATHS = [
  'minute',
  'Minute',
  'matchMinute',
  'gameMinute',
  'event.minute',
  'clock.minute',
  'time.minute',
  'dataSoccer.New.Minutes',
  'dataSoccer.Minutes',
  'data.New.Minutes',
  'data.Minutes',
  'New.Minutes',
  'live.minute',
  'fixture.minute',
  'match.minute',
  'state.minute',
  'clock.minutes',
  'clock.Minutes',
  'Clock.Minutes',
  'data.Clock.Minutes',
  'dataSoccer.Clock.Minutes',
  'payload.minute',
];

const SECOND_PATHS = [
  'clock.seconds',
  'Clock.seconds',
  'data.Clock.seconds',
  'data.New.Clock.seconds',
  'dataSoccer.Clock.seconds',
  'dataSoccer.New.Clock.seconds',
];

const TS_PATHS = [
  'ts',
  'Ts',
  'timestamp',
  'Timestamp',
  'timeStamp',
  'updatedAt',
  'lastUpdate',
  'eventTime',
  'time.utc',
  'created_at',
  'payload.ts',
  'payload.timestamp',
];

const FIXTURE_ID_PATHS = [
  'FixtureId',
  'fixtureId',
  'fixtureID',
  'fixture.id',
  'matchId',
  'payload.FixtureId',
  'payload.fixtureId',
  'payload.fixtureID',
  'data.FixtureId',
  'data.fixtureId',
  'data.fixtureID',
];

const EVENT_TYPE_PATHS = [
  'type',
  'eventType',
  'event_type',
  'event.type',
  'event.name',
  'incident.type',
  'payload.type',
  'payload.eventType',
  'dataSoccer.Action',
  'dataSoccer.Type',
  'data.Action',
  'data.Type',
];

const EVENT_TEAM_PATHS = [
  'team',
  'side',
  'teamSide',
  'event.team',
  'event.side',
  'participant',
  'participant.name',
  'competitor',
  'teamName',
  'payload.team',
  'payload.side',
  'participant',
  'Participant',
  'dataSoccer.Participant',
  'data.Participant',
];

const HOME_ALIASES = ['home', 'h', '1', 'homewin', 'home_win', 'homeodds', 'home_odds', 'homeprice', 'home_price'];
const DRAW_ALIASES = ['draw', 'x', 'tie', 'drawodds', 'draw_odds', 'drawprice', 'draw_price'];
const AWAY_ALIASES = ['away', 'a', '2', 'awaywin', 'away_win', 'awayodds', 'away_odds', 'awayprice', 'away_price'];
const ODDS_CONTAINERS = ['probs', 'probabilities', 'probability', 'odds', 'prices', 'price', 'market', 'payload'];
const ARRAY_CONTAINERS = ['data', 'items', 'events', 'updates', 'messages', 'results', 'fixtures', 'payload'];

export class TxOddsFeed extends BaseFeed {
  private ws: WebSocket | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly sseAbortControllers: AbortController[] = [];
  private stopped = false;
  private internalMatchId = '';
  private lastMinute = 0;
  private emittedKickoff = false;
  private emittedSecondHalf = false;
  private readonly seenEvents = new Set<string>();
  private lastOddsKey = '';
  private lastScoreTickKey = '';
  private lastProbs: Probs = { home: 0.4, draw: 0.26, away: 0.34 };
  private lastScore: Score = { home: 0, away: 0 };

  constructor(private readonly options: TxOddsFeedOptions) {
    super();
  }

  start(matchId: string): void {
    if (!this.options.apiUrl || !this.options.apiKey) {
      throw new Error(
        'TxOddsFeed: не заданы TXODDS_API_URL / TXODDS_API_KEY. ' +
          'Укажите их в .env или выберите FEED_SOURCE=sim|replay.',
      );
    }

    const mode = this.resolveMode();
    if (mode === 'sse' && !this.options.bearerToken.trim()) {
      throw new Error(
        'TxOddsFeed: для TXODDS_MODE=sse нужен TXODDS_BEARER_TOKEN (guest JWT) и TXODDS_API_KEY (activated API token).',
      );
    }

    this.internalMatchId = matchId;
    this.stopped = false;
    this.lastMinute = 0;
    this.emittedKickoff = false;
    this.emittedSecondHalf = false;
    this.seenEvents.clear();
    this.lastOddsKey = '';
    this.lastScoreTickKey = '';
    this.lastProbs = { home: 0.4, draw: 0.26, away: 0.34 };
    this.lastScore = { home: 0, away: 0 };

    if (mode === 'ws') this.openWebSocket();
    else if (mode === 'sse') this.openSseStreams();
    else this.startPolling();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const controller of this.sseAbortControllers) controller.abort();
    this.sseAbortControllers.length = 0;
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  private resolveMode(): 'poll' | 'ws' | 'sse' {
    if (this.options.mode === 'poll' || this.options.mode === 'ws' || this.options.mode === 'sse') return this.options.mode;
    return this.options.apiUrl.startsWith('ws://') || this.options.apiUrl.startsWith('wss://') ? 'ws' : 'poll';
  }

  private startPolling(): void {
    const poll = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        const res = await fetch(this.endpointUrl(), { headers: this.authHeaders() });
        if (!res.ok) {
          console.warn(`[txodds] HTTP ${res.status}: ${await res.text()}`);
          return;
        }
        this.processRawMessage(await res.json());
      } catch (err) {
        console.warn('[txodds] ошибка polling:', err);
      }
    };

    void poll();
    this.pollTimer = setInterval(() => void poll(), Math.max(250, this.options.pollMs));
  }

  private openWebSocket(): void {
    this.ws = new WebSocket(this.endpointUrl(), { headers: this.authHeaders() });
    this.ws.on('open', () => {
      if (!this.ws || this.stopped) return;
      const msg = this.options.subscribeMessage.trim();
      if (msg) this.ws.send(this.interpolateMatchId(msg));
      console.log('[txodds] WebSocket connected');
    });
    this.ws.on('message', (data) => {
      try {
        this.processRawMessage(JSON.parse(data.toString()));
      } catch (err) {
        console.warn('[txodds] не удалось разобрать WS-сообщение:', err);
      }
    });
    this.ws.on('error', (err) => console.warn('[txodds] WebSocket error:', err));
    this.ws.on('close', () => this.scheduleReconnect());
  }

  private openSseStreams(): void {
    this.openSseStream(this.endpointUrl(), 'odds');
    if (this.options.scoresApiUrl.trim()) {
      this.openSseStream(this.interpolateMatchId(this.options.scoresApiUrl), 'scores');
    }
  }

  private openSseStream(url: string, name: string): void {
    const controller = new AbortController();
    this.sseAbortControllers.push(controller);

    const connect = async (): Promise<void> => {
      while (!this.stopped && !controller.signal.aborted) {
        try {
          const res = await fetch(url, {
            headers: { ...this.authHeaders(), Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
            signal: controller.signal,
          });
          if (!res.ok) {
            console.warn(`[txodds] SSE ${name} HTTP ${res.status}: ${await res.text()}`);
            await delay(3000);
            continue;
          }
          console.log(`[txodds] SSE ${name} connected`);
          for await (const message of readSseMessages(res)) {
            if (this.stopped || controller.signal.aborted) return;
            if (message.event === 'heartbeat') continue;
            this.processRawMessage(message.data);
          }
        } catch (err) {
          if (!this.stopped && !controller.signal.aborted) {
            console.warn(`[txodds] SSE ${name} error:`, err);
            await delay(3000);
          }
        }
      }
    };

    void connect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.openWebSocket(), 3000);
  }

  private endpointUrl(): string {
    return this.interpolateMatchId(this.options.apiUrl);
  }

  private interpolateMatchId(value: string): string {
    const externalMatchId = this.options.matchId || this.internalMatchId;
    return value.replaceAll('{matchId}', encodeURIComponent(externalMatchId));
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'FanRaid/0.1' };
    if (this.options.bearerToken.trim()) headers.Authorization = `Bearer ${this.options.bearerToken}`;
    const header = this.options.apiKeyHeader.trim();
    if (header) {
      const prefix = this.options.apiKeyPrefix.trim();
      headers[header] = prefix ? `${prefix} ${this.options.apiKey}` : this.options.apiKey;
    }
    return headers;
  }

  private processRawMessage(raw: unknown): void {
    const normalized = normalizeTxOddsMessage(raw, {
      matchId: this.internalMatchId,
      fallbackMinute: this.lastMinute,
      payloadPath: this.options.payloadPath,
      minutePath: this.options.minutePath,
      tsPath: this.options.tsPath,
      oddsHomePath: this.options.oddsHomePath,
      oddsDrawPath: this.options.oddsDrawPath,
      oddsAwayPath: this.options.oddsAwayPath,
      eventTypePath: this.options.eventTypePath,
      eventTeamPath: this.options.eventTeamPath,
      homeTeamName: this.options.homeTeamName,
      awayTeamName: this.options.awayTeamName,
      externalMatchId: this.options.matchId,
    });

    for (const event of normalized.events) {
      this.emitMappedEvent(event);
    }
    for (const snapshot of normalized.scoreSnapshots) {
      this.emitScoreSnapshot(snapshot);
    }
    for (const odds of normalized.odds) {
      this.ensureLivePhase(odds.minute, odds.ts);
      this.lastMinute = odds.minute;
      this.lastProbs = odds.probs;
      const key = `${odds.minute}:${odds.probs.home.toFixed(6)}:${odds.probs.draw.toFixed(6)}:${odds.probs.away.toFixed(6)}`;
      if (key === this.lastOddsKey) continue;
      this.lastOddsKey = key;
      this.emitOdds(odds);
    }
  }

  private emitMappedEvent(event: MatchEvent): void {
    const key = `${event.type}:${event.minute}:${event.team ?? '-'}:${event.ts}`;
    if (this.seenEvents.has(key)) return;
    this.seenEvents.add(key);

    if (event.type === 'kickoff') this.emittedKickoff = true;
    if (event.type === 'second_half') this.emittedSecondHalf = true;
    this.lastMinute = event.minute;
    if (event.type === 'goal' && event.team) {
      this.lastScore = { ...this.lastScore, [event.team]: this.lastScore[event.team] + 1 };
    }
    this.emitMatch(event);
  }

  private emitScoreSnapshot(snapshot: NormalizedScoreSnapshot): void {
    this.ensureLivePhase(snapshot.minute, snapshot.ts);
    this.lastMinute = snapshot.minute;

    const homeGoals = Math.max(0, snapshot.score.home - this.lastScore.home);
    const awayGoals = Math.max(0, snapshot.score.away - this.lastScore.away);
    let offset = 0;
    for (let i = 0; i < homeGoals; i += 1) {
      this.emitMappedEvent({ matchId: this.internalMatchId, ts: snapshot.ts + offset, minute: snapshot.minute, type: 'goal', team: 'home' });
      offset += 1;
    }
    for (let i = 0; i < awayGoals; i += 1) {
      this.emitMappedEvent({ matchId: this.internalMatchId, ts: snapshot.ts + offset, minute: snapshot.minute, type: 'goal', team: 'away' });
      offset += 1;
    }

    this.lastScore = snapshot.score;
    const key = `${snapshot.minute}:${snapshot.score.home}:${snapshot.score.away}`;
    if (key === this.lastScoreTickKey) return;
    this.lastScoreTickKey = key;
    this.emitOdds({
      matchId: this.internalMatchId,
      ts: snapshot.ts,
      minute: snapshot.minute,
      probs: this.lastProbs,
    });
  }

  private ensureLivePhase(minute: number, ts: number): void {
    if (!this.emittedKickoff) {
      this.emittedKickoff = true;
      this.emitMatch({ matchId: this.internalMatchId, ts, minute: 0, type: 'kickoff' });
    }
    if (minute >= MATCH.FIRST_HALF_END_MINUTE && !this.emittedSecondHalf) {
      this.emittedSecondHalf = true;
      this.emitMatch({ matchId: this.internalMatchId, ts, minute: MATCH.FIRST_HALF_END_MINUTE, type: 'second_half' });
    }
  }
}

export function normalizeTxOddsMessage(raw: unknown, options: TxOddsNormalizerOptions): NormalizedTxOddsMessage {
  const root = options.payloadPath ? getPath(raw, options.payloadPath) : raw;
  const items = extractItems(root);
  const odds: OddsUpdate[] = [];
  const events: MatchEvent[] = [];
  const scoreSnapshots: NormalizedScoreSnapshot[] = [];

  for (const item of items) {
    if (!matchesExternalFixture(item, options.externalMatchId)) continue;
    const event = mapEvent(item, options);
    if (event) events.push(event);
    const scoreSnapshot = mapScoreSnapshot(item, options);
    if (scoreSnapshot) scoreSnapshots.push(scoreSnapshot);
    const update = mapOdds(item, options);
    if (update) odds.push(update);
  }

  return { odds, events, scoreSnapshots };
}

function extractItems(root: unknown): unknown[] {
  if (Array.isArray(root)) return root;
  if (!isObject(root)) return [root];

  const collected: unknown[] = [root];
  for (const key of ARRAY_CONTAINERS) {
    const value = getLoose(root, [key]);
    if (Array.isArray(value)) collected.push(...value);
    else if (isObject(value)) collected.push(value);
  }
  return collected;
}

function matchesExternalFixture(raw: unknown, externalMatchId: string | undefined): boolean {
  const expected = externalMatchId?.trim();
  if (!expected) return true;

  const value = firstPath(raw, FIXTURE_ID_PATHS);
  if (value === undefined || value === null || value === '') return true;
  return String(value) === expected;
}

function mapOdds(raw: unknown, options: TxOddsNormalizerOptions): OddsUpdate | null {
  const values = readOddsValues(raw, options);
  if (!values) return null;

  const probs = valuesToProbs(values);
  if (!probs) return null;

  return {
    matchId: options.matchId,
    ts: readTs(raw, options) ?? Date.now(),
    minute: readMinute(raw, options) ?? options.fallbackMinute,
    probs,
  };
}

function mapEvent(raw: unknown, options: TxOddsNormalizerOptions): MatchEvent | null {
  const configuredType = options.eventTypePath ? getPath(raw, options.eventTypePath) : undefined;
  const txLineType = readTxLineEventType(raw);
  const typeRaw = configuredType ?? txLineType ?? firstPath(raw, EVENT_TYPE_PATHS);
  const type = mapEventType(typeRaw);
  if (!type) return null;

  const configuredTeam = options.eventTeamPath ? getPath(raw, options.eventTeamPath) : undefined;
  const team = configuredTeam
    ? mapTeamSide(configuredTeam, options)
    : participantToTeamSide(raw) ?? mapTeamSide(firstPath(raw, EVENT_TEAM_PATHS), options);
  const event: MatchEvent = {
    matchId: options.matchId,
    ts: readTs(raw, options) ?? Date.now(),
    minute: readMinute(raw, options) ?? options.fallbackMinute,
    type,
  };
  if (team) event.team = team;
  return event;
}

function mapScoreSnapshot(raw: unknown, options: TxOddsNormalizerOptions): NormalizedScoreSnapshot | null {
  const score = readScore(raw);
  if (!score) return null;

  return {
    matchId: options.matchId,
    ts: readTs(raw, options) ?? Date.now(),
    minute: readMinute(raw, options) ?? options.fallbackMinute,
    score,
  };
}

function readTxLineEventType(raw: unknown): unknown {
  const explicit = firstPath(raw, [
    'action',
    'Action',
    'type',
    'Type',
    'dataSoccer.Action',
    'dataSoccer.Type',
    'data.Action',
    'data.Type',
    'data.New.Action',
    'data.New.Type',
  ]);
  if (explicit !== undefined && explicit !== null && explicit !== '') return explicit;

  const booleanAliases: Array<[MatchEventType, string[]]> = [
    ['goal', ['dataSoccer.Goal', 'data.Goal', 'goal']],
    ['corner', ['dataSoccer.Corner', 'data.Corner', 'corner']],
    ['yellow_card', ['dataSoccer.YellowCard', 'data.YellowCard', 'yellowCard']],
    ['red_card', ['dataSoccer.RedCard', 'data.RedCard', 'redCard']],
    ['shot_on_target', ['dataSoccer.ShotOnTarget', 'data.ShotOnTarget', 'shotOnTarget']],
    ['shot', ['dataSoccer.Shot', 'data.Shot', 'shot']],
  ];

  for (const [type, paths] of booleanAliases) {
    if (paths.some((path) => getPath(raw, path) === true)) return type;
  }
  return undefined;
}

function participantToTeamSide(raw: unknown): TeamSide | null {
  const participant = firstNumber(raw, [
    'participant',
    'Participant',
    'dataSoccer.Participant',
    'dataSoccer.New.Participant',
    'data.Participant',
    'data.New.Participant',
  ]);
  if (participant !== 1 && participant !== 2) return null;

  const participant1IsHome = firstPath(raw, ['participant1IsHome', 'Participant1IsHome']);
  const isP1Home = participant1IsHome === false ? false : true;
  if (participant === 1) return isP1Home ? 'home' : 'away';
  return isP1Home ? 'away' : 'home';
}

function readOddsValues(raw: unknown, options: TxOddsNormalizerOptions): [number, number, number] | null {
  if (options.oddsHomePath && options.oddsDrawPath && options.oddsAwayPath) {
    const home = toNumber(getPath(raw, options.oddsHomePath));
    const draw = toNumber(getPath(raw, options.oddsDrawPath));
    const away = toNumber(getPath(raw, options.oddsAwayPath));
    if (home !== null && draw !== null && away !== null) return [home, draw, away];
  }

  const txLineValues = readTxLineOddsValues(raw, options);
  if (txLineValues) return txLineValues;

  for (const container of objectContainers(raw)) {
    const home = toNumber(getLoose(container, HOME_ALIASES));
    const draw = toNumber(getLoose(container, DRAW_ALIASES));
    const away = toNumber(getLoose(container, AWAY_ALIASES));
    if (home !== null && draw !== null && away !== null) return [home, draw, away];
  }

  return readMarketValues(raw, options);
}

function readScore(raw: unknown): Score | null {
  const directPairs: Array<[string, string]> = [
    ['score.home', 'score.away'],
    ['scores.home', 'scores.away'],
    ['Score.Home', 'Score.Away'],
    ['Scores.Home', 'Scores.Away'],
    ['homeScore', 'awayScore'],
    ['HomeScore', 'AwayScore'],
    ['home.score', 'away.score'],
    ['teams.home.score', 'teams.away.score'],
    ['dataSoccer.New.Score.Home', 'dataSoccer.New.Score.Away'],
    ['dataSoccer.New.Scores.Home', 'dataSoccer.New.Scores.Away'],
    ['dataSoccer.Score.Home', 'dataSoccer.Score.Away'],
    ['dataSoccer.Scores.Home', 'dataSoccer.Scores.Away'],
    ['data.New.Score.Home', 'data.New.Score.Away'],
    ['data.New.Scores.Home', 'data.New.Scores.Away'],
    ['data.Score.Home', 'data.Score.Away'],
    ['data.Scores.Home', 'data.Scores.Away'],
    ['New.Score.Home', 'New.Score.Away'],
    ['New.Scores.Home', 'New.Scores.Away'],
  ];

  for (const [homePath, awayPath] of directPairs) {
    const home = toNumber(getPath(raw, homePath));
    const away = toNumber(getPath(raw, awayPath));
    if (home !== null && away !== null) return normalizeScore(home, away);
  }

  const value = firstPath(raw, [
    'score',
    'Score',
    'scores',
    'Scores',
    'dataSoccer.New.Score',
    'dataSoccer.New.Scores',
    'dataSoccer.Score',
    'dataSoccer.Scores',
    'data.New.Score',
    'data.New.Scores',
    'data.Score',
    'data.Scores',
    'New.Score',
    'New.Scores',
  ]);
  return scoreFromValue(value, participant1IsHome(raw));
}

function scoreFromValue(value: unknown, participant1IsHomeValue: boolean): Score | null {
  if (Array.isArray(value) && value.length >= 2) {
    const first = toNumber(value[0]);
    const second = toNumber(value[1]);
    if (first === null || second === null) return null;
    return participantScoreToHomeAway(first, second, participant1IsHomeValue);
  }

  if (typeof value === 'string') {
    const match = value.trim().match(/(\d+)\s*[:-]\s*(\d+)/);
    if (!match) return null;
    return normalizeScore(Number(match[1]), Number(match[2]));
  }

  if (isObject(value)) {
    const home = toNumber(getLoose(value, ['home', 'homeScore', 'h', '1', 'participant1']));
    const away = toNumber(getLoose(value, ['away', 'awayScore', 'a', '2', 'participant2']));
    if (home !== null && away !== null) return normalizeScore(home, away);
  }

  return null;
}

function participantScoreToHomeAway(participant1: number, participant2: number, participant1IsHomeValue: boolean): Score {
  return participant1IsHomeValue
    ? normalizeScore(participant1, participant2)
    : normalizeScore(participant2, participant1);
}

function normalizeScore(home: number, away: number): Score {
  return {
    home: Math.max(0, Math.floor(home)),
    away: Math.max(0, Math.floor(away)),
  };
}

function participant1IsHome(raw: unknown): boolean {
  const value = firstPath(raw, ['participant1IsHome', 'Participant1IsHome', 'dataSoccer.Participant1IsHome', 'data.Participant1IsHome']);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return normalizeKey(value) !== 'false';
  return true;
}

function readTxLineOddsValues(raw: unknown, options: TxOddsNormalizerOptions): [number, number, number] | null {
  if (!isObject(raw)) return null;

  const namesRaw = getLoose(raw, ['PriceNames', 'priceNames', 'price_names']);
  if (!Array.isArray(namesRaw)) return null;

  const pctRaw = getLoose(raw, ['Pct', 'pct', 'percentages', 'percent']);
  const pricesRaw = getLoose(raw, ['Prices', 'prices', 'Price', 'price']);
  const valuesRaw = Array.isArray(pctRaw) && pctRaw.length > 0 ? pctRaw : pricesRaw;
  if (!Array.isArray(valuesRaw)) return null;

  const found: Partial<Record<'home' | 'draw' | 'away', number>> = {};
  namesRaw.forEach((name, index) => {
    const side = sideFromTxLinePriceName(name, options);
    const value = toNumber(valuesRaw[index]);
    if (side && value !== null) found[side] = value;
  });

  if (found.home !== undefined && found.draw !== undefined && found.away !== undefined) {
    return [found.home, found.draw, found.away];
  }
  return null;
}

function sideFromTxLinePriceName(value: unknown, options: TxOddsNormalizerOptions): 'home' | 'draw' | 'away' | null {
  const side = mapTeamSide(value, options);
  if (side) return side;

  const normalized = normalizeKey(value);
  if (!normalized) return null;
  if (['home', 'homewin', 'participant1', 'participant1win', 'p1', 'p1win', 'team1', 'team1win', '1'].includes(normalized)) {
    return 'home';
  }
  if (['draw', 'tie', 'x'].includes(normalized)) return 'draw';
  if (['away', 'awaywin', 'participant2', 'participant2win', 'p2', 'p2win', 'team2', 'team2win', '2'].includes(normalized)) {
    return 'away';
  }
  return null;
}

function objectContainers(raw: unknown): JsonObject[] {
  if (!isObject(raw)) return [];
  const containers: JsonObject[] = [raw];
  for (const key of ODDS_CONTAINERS) {
    const value = getLoose(raw, [key]);
    if (isObject(value)) containers.push(value);
  }
  return containers;
}

function readMarketValues(raw: unknown, options: TxOddsNormalizerOptions): [number, number, number] | null {
  const markets = collectArrays(raw, ['markets', 'market', 'odds', 'prices', 'bookmakers']);
  for (const market of markets) {
    if (!isObject(market)) continue;
    const selections = collectArrays(market, ['selections', 'outcomes', 'runners', 'prices', 'participants']);
    const found: Partial<Record<'home' | 'draw' | 'away', number>> = {};

    for (const selection of selections) {
      if (!isObject(selection)) continue;
      const side = sideFromSelection(selection, options);
      if (!side) continue;
      const value = firstNumber(selection, ['probability', 'prob', 'price', 'odds', 'decimalOdds', 'decimal', 'value']);
      if (value !== null) found[side] = value;
    }

    if (found.home !== undefined && found.draw !== undefined && found.away !== undefined) {
      return [found.home, found.draw, found.away];
    }
  }
  return null;
}

function collectArrays(raw: unknown, keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isObject(raw)) return [];
  const values: unknown[] = [];
  for (const key of keys) {
    const value = getLoose(raw, [key]);
    if (Array.isArray(value)) values.push(...value);
    else if (isObject(value)) values.push(value);
  }
  return values;
}

function sideFromSelection(selection: JsonObject, options: TxOddsNormalizerOptions): 'home' | 'draw' | 'away' | null {
  const side = mapTeamSide(firstPath(selection, ['side', 'type', 'outcomeType']), options);
  if (side) return side;

  const label = firstPath(selection, ['name', 'label', 'outcome', 'selection', 'runnerName', 'teamName', 'participant']);
  const normalized = normalizeKey(label);
  if (['home', 'h', '1', 'homewin'].includes(normalized)) return 'home';
  if (['draw', 'x', 'tie'].includes(normalized)) return 'draw';
  if (['away', 'a', '2', 'awaywin'].includes(normalized)) return 'away';
  if (options.homeTeamName && normalized === normalizeKey(options.homeTeamName)) return 'home';
  if (options.awayTeamName && normalized === normalizeKey(options.awayTeamName)) return 'away';
  return null;
}

function valuesToProbs(values: [number, number, number]): Probs | null {
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return null;

  const max = Math.max(...values);
  const sum = values[0] + values[1] + values[2];
  let raw: [number, number, number];

  if (max <= 1.000001) raw = values;
  else if (sum >= 95 && sum <= 105 && max <= 100) raw = [values[0] / 100, values[1] / 100, values[2] / 100];
  else raw = [1 / values[0], 1 / values[1], 1 / values[2]];

  const total = raw[0] + raw[1] + raw[2];
  if (!Number.isFinite(total) || total <= 0) return null;
  return { home: raw[0] / total, draw: raw[1] / total, away: raw[2] / total };
}

function readMinute(raw: unknown, options: TxOddsNormalizerOptions): number | null {
  const value = options.minutePath ? getPath(raw, options.minutePath) : firstPath(raw, MINUTE_PATHS);
  const n = toNumber(value);
  if (n !== null) return Math.max(0, Math.floor(n));

  const seconds = toNumber(firstPath(raw, SECOND_PATHS));
  return seconds === null ? null : Math.max(0, Math.floor(seconds / 60));
}

function readTs(raw: unknown, options: TxOddsNormalizerOptions): number | null {
  const value = options.tsPath ? getPath(raw, options.tsPath) : firstPath(raw, TS_PATHS);
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1_000_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n < 1_000_000_000_000 ? n * 1000 : n;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapEventType(value: unknown): MatchEventType | null {
  const normalized = normalizeKey(value);
  if (!normalized) return null;
  for (const [type, aliases] of EVENT_TYPE_ALIASES) {
    if (aliases.includes(normalized)) return type;
  }
  return null;
}

function mapTeamSide(value: unknown, options: TxOddsNormalizerOptions): TeamSide | null {
  const normalized = normalizeKey(value);
  if (!normalized) return null;
  if (['home', 'h', '1', 'hometeam'].includes(normalized)) return 'home';
  if (['away', 'a', '2', 'awayteam'].includes(normalized)) return 'away';
  if (options.homeTeamName && normalized === normalizeKey(options.homeTeamName)) return 'home';
  if (options.awayTeamName && normalized === normalizeKey(options.awayTeamName)) return 'away';
  return null;
}

function firstPath(raw: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = getPath(raw, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function firstNumber(raw: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = toNumber(getPath(raw, path));
    if (value !== null) return value;
  }
  return null;
}

function getPath(raw: unknown, path: string): unknown {
  if (!path) return undefined;
  let current = raw;
  for (const part of path.replaceAll('[', '.').replaceAll(']', '').split('.').filter(Boolean)) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function getLoose(raw: unknown, aliases: string[]): unknown {
  if (!isObject(raw)) return undefined;
  const wanted = new Set(aliases.map(normalizeKey));
  for (const [key, value] of Object.entries(raw)) {
    if (wanted.has(normalizeKey(key))) return value;
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace('%', '').trim();
    const match = cleaned.match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return null;
    const n = Number(match[0].replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeKey(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).toLowerCase().replace(/[^a-zа-я0-9]/giu, '');
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function* readSseMessages(response: Response): AsyncGenerator<SseMessage> {
  if (!response.body) throw new Error('Stream response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.match(/\r?\n\r?\n/);
      while (separator?.index !== undefined) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);

        const message = parseSseBlock(block);
        if (message) yield message;

        separator = buffer.match(/\r?\n\r?\n/);
      }
    }

    buffer += decoder.decode();
    const message = parseSseBlock(buffer);
    if (message) yield message;
  } finally {
    reader.releaseLock();
  }
}

function parseSseBlock(block: string): SseMessage | null {
  let data = '';
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const separatorIndex = rawLine.indexOf(':');
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? '' : rawLine.slice(separatorIndex + 1).replace(/^ /, '');

    if (field === 'data') data += `${value}\n`;
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'retry') {
      const n = Number(value);
      if (Number.isFinite(n)) retry = n;
    }
  }

  data = data.replace(/\n$/, '');
  if (!data && !event && !id) return null;

  const message: SseMessage = { data: parseSseData(data) };
  if (event) message.event = event;
  if (id) message.id = id;
  if (retry !== undefined) message.retry = retry;
  return message;
}

function parseSseData(data: string): unknown {
  if (!data) return '';
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
