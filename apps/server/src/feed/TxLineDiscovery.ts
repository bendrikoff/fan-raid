import { MATCH_ID, TEAM_NAMES, type MatchInfo, type TeamSide } from '@fan-raid/shared';
import type { AppConfig } from '../config.js';

export interface ResolvedMatch {
  info: MatchInfo;
  externalFixtureId: string;
  bearerToken?: string;
}

export interface ParsedFixture {
  fixtureId: string;
  home: string;
  away: string;
  startsAt?: string;
  competition?: string;
  status: MatchInfo['status'];
  sortTime: number;
  raw: unknown;
}

const TXLINE_DEV_ORIGIN = 'https://txline-dev.txodds.com';

export async function resolveMatchForFeed(config: AppConfig): Promise<ResolvedMatch> {
  if (config.feedSource !== 'txodds') {
    return {
      externalFixtureId: MATCH_ID,
      info: {
        id: MATCH_ID,
        source: config.feedSource,
        isReal: false,
        teams: { home: TEAM_NAMES.home, away: TEAM_NAMES.away },
        status: 'live',
      },
    };
  }

  const apiOrigin = txLineApiOrigin(config);
  let bearerToken = config.txoddsBearerToken || (await startGuestSession(apiOrigin));
  let fixtures: unknown[];
  try {
    fixtures = await fetchTxLineFixtures(config, apiOrigin, bearerToken);
  } catch (err) {
    if (!config.txoddsBearerToken || !String(err).includes('HTTP 401')) throw err;
    console.warn('[txline] stored guest JWT expired, requesting a fresh guest JWT');
    bearerToken = await startGuestSession(apiOrigin);
    fixtures = await fetchTxLineFixtures(config, apiOrigin, bearerToken);
  }
  const selected = selectTxLineFixture(fixtures, config.txoddsMatchId, Date.now());
  if (!selected) {
    throw new Error('TxLINE fixtures/snapshot вернул пустой список матчей. Проверь TXODDS_API_KEY и entitlement FreeTier.');
  }

  console.log(
    `[txline] auto-selected fixture ${selected.fixtureId}: ${selected.home} vs ${selected.away}` +
      (selected.startsAt ? ` (${selected.startsAt})` : ''),
  );

  return {
    externalFixtureId: selected.fixtureId,
    bearerToken,
    info: {
      id: `txline-${selected.fixtureId}`,
      externalId: selected.fixtureId,
      source: 'txodds',
      isReal: true,
      teams: { home: selected.home, away: selected.away },
      competition: selected.competition,
      startsAt: selected.startsAt,
      status: selected.status,
    },
  };
}

export function txLineApiOrigin(config: AppConfig): string {
  if (config.txoddsApiUrl) return new URL(config.txoddsApiUrl).origin;
  return TXLINE_DEV_ORIGIN;
}

export function defaultTxLineOddsStreamUrl(config: AppConfig): string {
  return `${txLineApiOrigin(config)}/api/odds/stream?fixtureId={matchId}`;
}

export function defaultTxLineScoresStreamUrl(config: AppConfig): string {
  return `${txLineApiOrigin(config)}/api/scores/stream?fixtureId={matchId}`;
}

export async function listTxLineFixtures(config: AppConfig): Promise<ParsedFixture[]> {
  if (config.feedSource !== 'txodds') return [];

  const apiOrigin = txLineApiOrigin(config);
  let bearerToken = config.txoddsBearerToken || (await startGuestSession(apiOrigin));
  let rawFixtures: unknown[];
  try {
    rawFixtures = await fetchTxLineFixtures(config, apiOrigin, bearerToken);
  } catch (err) {
    if (!config.txoddsBearerToken || !String(err).includes('HTTP 401')) throw err;
    bearerToken = await startGuestSession(apiOrigin);
    rawFixtures = await fetchTxLineFixtures(config, apiOrigin, bearerToken);
  }

  return rawFixtures
    .map((raw) => parseTxLineFixture(raw, Date.now()))
    .filter((fixture): fixture is ParsedFixture => fixture !== null)
    .sort((a, b) => a.sortTime - b.sortTime);
}

export function selectTxLineFixture(rawFixtures: unknown[], preferredFixtureId: string, nowMs: number): ParsedFixture | null {
  const fixtures = rawFixtures.map((raw) => parseTxLineFixture(raw, nowMs)).filter((f): f is ParsedFixture => f !== null);
  if (fixtures.length === 0) return null;

  const preferred = preferredFixtureId.trim();
  if (preferred) {
    const found = fixtures.find((f) => f.fixtureId === preferred);
    if (found) return found;
    console.warn(`[txline] TXODDS_MATCH_ID=${preferred} не найден в fixtures/snapshot, выбираю матч автоматически`);
  }

  const live = fixtures
    .filter((f) => f.status === 'live')
    .sort((a, b) => Math.abs(a.sortTime - nowMs) - Math.abs(b.sortTime - nowMs));
  if (live[0]) return live[0];

  const upcoming = fixtures.filter((f) => f.status === 'upcoming').sort((a, b) => a.sortTime - b.sortTime);
  if (upcoming[0]) return upcoming[0];

  return fixtures.sort((a, b) => Math.abs(a.sortTime - nowMs) - Math.abs(b.sortTime - nowMs))[0] ?? null;
}

export function parseTxLineFixture(raw: unknown, nowMs = Date.now()): ParsedFixture | null {
  const fixtureId = textAt(raw, ['FixtureId', 'fixtureId', 'Id', 'id']);
  if (!fixtureId) return null;

  const participant1 = textAt(raw, ['Participant1', 'participant1', 'Participants.0', 'participants.0']) ?? 'Home';
  const participant2 = textAt(raw, ['Participant2', 'participant2', 'Participants.1', 'participants.1']) ?? 'Away';
  const participant1IsHome = booleanAt(raw, ['Participant1IsHome', 'participant1IsHome']);
  const p1Home = participant1IsHome !== false;
  const startTimeMs = timestampAt(raw, ['StartTime', 'startTime', 'StartsAt', 'startsAt', 'Kickoff', 'kickoff']);
  const startsAt = startTimeMs === undefined ? undefined : new Date(startTimeMs).toISOString();
  const sortTime = startTimeMs ?? Number.NaN;
  const status = inferFixtureStatus(raw, sortTime, nowMs);

  return {
    fixtureId,
    home: p1Home ? participant1 : participant2,
    away: p1Home ? participant2 : participant1,
    startsAt,
    competition: textAt(raw, ['Competition', 'competition', 'FixtureGroup', 'fixtureGroup', 'CompetitionName', 'competitionName']),
    status,
    sortTime: Number.isFinite(sortTime) ? sortTime : nowMs,
    raw,
  };
}

async function fetchTxLineFixtures(config: AppConfig, apiOrigin: string, bearerToken: string): Promise<unknown[]> {
  if (!config.txoddsApiKey) {
    throw new Error('Для TxODDS нужен TXODDS_API_KEY. Получи его через pnpm txline:activate или вставь один раз в .env.');
  }

  const response = await fetch(`${apiOrigin}/api/fixtures/snapshot`, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'X-Api-Token': config.txoddsApiKey,
      Accept: 'application/json',
    },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(`TxLINE fixtures/snapshot HTTP ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return Array.isArray(body) ? body : [];
}

async function startGuestSession(apiOrigin: string): Promise<string> {
  const response = await fetch(`${apiOrigin}/auth/guest/start`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`TxLINE guest session HTTP ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token) {
    throw new Error('TxLINE guest session response does not contain token');
  }
  return body.token;
}

function inferFixtureStatus(raw: unknown, startMs: number, nowMs: number): MatchInfo['status'] {
  const rawStatus = normalize(textAt(raw, ['Status', 'status', 'GameState', 'gameState', 'State', 'state']));
  if (['live', 'inplay', 'inrunning', 'running', '1h', '2h', 'ht'].includes(rawStatus)) return 'live';
  if (['finished', 'ended', 'fulltime', 'ft', 'complete', 'completed'].includes(rawStatus)) return 'finished';
  if (['scheduled', 'notstarted', 'upcoming', 'pre', 'prematch'].includes(rawStatus)) return 'upcoming';

  if (Number.isFinite(startMs)) {
    const liveFrom = startMs - 15 * 60_000;
    const liveTo = startMs + 150 * 60_000;
    if (nowMs >= liveFrom && nowMs <= liveTo) return 'live';
    if (nowMs < startMs) return 'upcoming';
    return 'finished';
  }
  return 'unknown';
}

function textAt(raw: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getPath(raw, path);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function booleanAt(raw: unknown, paths: string[]): boolean | undefined {
  for (const path of paths) {
    const value = getPath(raw, path);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = normalize(value);
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
  }
  return undefined;
}

function timestampAt(raw: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getPath(raw, path);
    if (typeof value === 'number' && Number.isFinite(value)) return normalizeEpochMs(value);
    if (typeof value !== 'string') continue;

    const trimmed = value.trim();
    if (!trimmed) continue;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return normalizeEpochMs(numeric);

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeEpochMs(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
}

function getPath(raw: unknown, path: string): unknown {
  let current = raw;
  for (const part of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function normalize(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}
