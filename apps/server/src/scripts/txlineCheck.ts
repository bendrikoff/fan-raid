import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

type CheckStatus = 'ok' | 'warn' | 'fail';

interface FixtureSummary {
  id: string;
  label: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../../..');

loadEnv({ path: resolve(repoRoot, '.env') });
loadEnv();

async function main(): Promise<void> {
  const env = process.env;
  const apiOrigin = readApiOrigin(env.TXODDS_API_URL);
  const apiKey = env.TXODDS_API_KEY ?? '';
  const effectiveFeedSource = apiKey ? 'txodds' : env.FEED_SOURCE || 'sim';
  const effectiveMode = apiKey && (!env.TXODDS_MODE || env.TXODDS_MODE === 'auto') ? 'sse' : env.TXODDS_MODE || 'auto';
  const effectiveOddsUrl = env.TXODDS_API_URL || `${apiOrigin}/api/odds/stream?fixtureId={matchId}`;
  const effectiveScoresUrl = env.TXODDS_SCORES_API_URL || `${apiOrigin}/api/scores/stream?fixtureId={matchId}`;
  const bearerToken = env.TXODDS_BEARER_TOKEN || (apiKey ? await startGuestSession(apiOrigin) : '');

  const checks: Array<[CheckStatus, string]> = [
    [apiKey && effectiveFeedSource === 'txodds' ? 'ok' : 'warn', `FEED_SOURCE=${env.FEED_SOURCE || '<empty>'} (effective ${effectiveFeedSource})`],
    [apiKey && effectiveMode === 'sse' ? 'ok' : 'warn', `TXODDS_MODE=${env.TXODDS_MODE || '<empty>'} (effective ${effectiveMode})`],
    ['ok', `TXODDS_API_URL=${env.TXODDS_API_URL || `<auto ${effectiveOddsUrl}>`}`],
    ['ok', `TXODDS_SCORES_API_URL=${env.TXODDS_SCORES_API_URL || `<auto ${effectiveScoresUrl}>`}`],
    [env.TXODDS_MATCH_ID ? 'ok' : 'ok', `TXODDS_MATCH_ID=${env.TXODDS_MATCH_ID || '<auto>'}`],
    [bearerToken ? 'ok' : 'fail', `TXODDS_BEARER_TOKEN=${env.TXODDS_BEARER_TOKEN ? mask(env.TXODDS_BEARER_TOKEN) : '<auto guest JWT>'}`],
    [apiKey ? 'ok' : 'fail', `TXODDS_API_KEY=${mask(apiKey)}`],
    ['ok', `TXODDS_API_KEY_HEADER=${env.TXODDS_API_KEY_HEADER || '<empty>'} (effective X-Api-Token)`],
    ['ok', `TXODDS_API_KEY_PREFIX=${env.TXODDS_API_KEY_PREFIX === '' ? '<empty>' : env.TXODDS_API_KEY_PREFIX || '<unset>'} (effective <empty>)`],
  ];

  console.log('[txline:check] local configuration');
  for (const [status, text] of checks) {
    console.log(`${icon(status)} ${text}`);
  }

  const hardFailure = checks.some(([status]) => status === 'fail');
  if (hardFailure) {
    console.log('');
    if (!apiKey) {
      console.log('[txline:check] not ready: TXODDS_API_KEY is empty.');
      console.log('[txline:check] Either paste your activated TxLINE API token into .env, or run: pnpm txline:activate -- --skip-airdrop');
    } else {
      console.log('[txline:check] not ready. Run: pnpm txline:activate');
    }
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`[txline:check] API origin=${apiOrigin}`);
  let fixtures: unknown[];
  try {
    fixtures = await fetchFixtures(apiOrigin, bearerToken, apiKey);
  } catch (err) {
    if (!env.TXODDS_BEARER_TOKEN || !String(err).includes('HTTP 401')) throw err;
    const freshBearer = await startGuestSession(apiOrigin);
    fixtures = await fetchFixtures(apiOrigin, freshBearer, apiKey);
  }
  console.log(`OK fixtures/snapshot returned ${fixtures.length} fixture(s)`);

  for (const fixture of fixtures.slice(0, 5).map(summarizeFixture)) {
    console.log(`- ${fixture.id}: ${fixture.label}`);
  }

  if (!env.TXODDS_MATCH_ID && fixtures.length > 0) {
    console.log('');
    console.log('TXODDS_MATCH_ID is empty, so the backend will auto-pick a live or nearest upcoming fixture.');
  }
}

async function startGuestSession(apiOrigin: string): Promise<string> {
  const response = await fetch(`${apiOrigin}/auth/guest/start`, { method: 'POST' });
  if (!response.ok) return '';
  const body = (await response.json()) as { token?: unknown };
  return typeof body.token === 'string' ? body.token : '';
}

async function fetchFixtures(apiOrigin: string, jwt: string, apiToken: string): Promise<unknown[]> {
  const response = await fetch(`${apiOrigin}/api/fixtures/snapshot`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Api-Token': apiToken,
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(`fixtures/snapshot failed: HTTP ${response.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return Array.isArray(body) ? body : [];
}

function summarizeFixture(raw: unknown): FixtureSummary {
  const id = String(
    getPath(raw, 'fixtureId') ??
      getPath(raw, 'FixtureId') ??
      getPath(raw, 'id') ??
      getPath(raw, 'Id') ??
      '<unknown>',
  );
  const p1 = firstText(raw, [
    'participant1.name',
    'Participant1.Name',
    'participants.0.name',
    'Participants.0.Name',
    'home.name',
    'Home.Name',
  ]);
  const p2 = firstText(raw, [
    'participant2.name',
    'Participant2.Name',
    'participants.1.name',
    'Participants.1.Name',
    'away.name',
    'Away.Name',
  ]);
  const competition = firstText(raw, ['competition', 'Competition', 'competition.name', 'Competition.Name']);
  const startsAt = firstText(raw, ['startsAt', 'StartsAt', 'startTime', 'StartTime', 'kickoff', 'Kickoff']);
  const label = [p1 && p2 ? `${p1} vs ${p2}` : undefined, competition, startsAt].filter(Boolean).join(' | ');
  return { id, label: label || JSON.stringify(raw).slice(0, 140) };
}

function firstText(raw: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getPath(raw, path);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
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

function readApiOrigin(apiUrl: string | undefined): string {
  if (!apiUrl) return 'https://txline-dev.txodds.com';
  return new URL(apiUrl).origin;
}

function icon(status: CheckStatus): string {
  if (status === 'ok') return 'OK  ';
  if (status === 'warn') return 'WARN';
  return 'FAIL';
}

function mask(value: string | undefined): string {
  if (!value) return '<empty>';
  if (value.length <= 16) return '<set>';
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

main().catch((err) => {
  console.error('[txline:check] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
