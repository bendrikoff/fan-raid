import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Load .env from the server cwd and from the monorepo root (dotenv does not overwrite
// already-set variables, so external env values keep priority).
const here = dirname(fileURLToPath(import.meta.url)); // apps/server/src
loadEnv(); // ./.env relative to cwd (apps/server)
loadEnv({ path: resolve(here, '../../../.env') }); // monorepo root

export type FeedSourceKind = 'sim' | 'replay' | 'txodds';
export type TxOddsMode = 'auto' | 'poll' | 'ws' | 'sse';

const hasTxOddsApiKey = Boolean(process.env.TXODDS_API_KEY);
const configuredFeedSource = process.env.FEED_SOURCE as FeedSourceKind | undefined;
const feedSource: FeedSourceKind =
  configuredFeedSource === 'replay' ? 'replay' : hasTxOddsApiKey ? 'txodds' : configuredFeedSource ?? 'sim';

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === 'true' || v === '1';
}

function num(v: string | undefined, def: number): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const dataDir = process.env.DATA_DIR ?? '';
function dataPath(name: string): string {
  return dataDir ? resolve(dataDir, name) : `./${name}`;
}

export const config = {
  dataDir,
  dbPath: process.env.DB_PATH ?? dataPath('fan-raid.sqlite'),
  recordingsDir: process.env.RECORDINGS_DIR ?? dataPath('recordings'),
  uploadsDir: process.env.UPLOADS_DIR ?? '',
  feedSource,
  replayFile: process.env.REPLAY_FILE ?? dataPath('recordings/demo.jsonl'),
  replaySpeed: num(process.env.REPLAY_SPEED, 10),
  simSpeed: num(process.env.SIM_SPEED, 12),
  simSeed: process.env.SIM_SEED ? num(process.env.SIM_SEED, 0) : undefined,
  devMode: bool(process.env.DEV_MODE, true),
  // Auto-restart the match after the final whistle (useful for dev/demo).
  matchAutorestart: bool(process.env.MATCH_AUTORESTART, true),
  matchRestartDelayMs: num(process.env.MATCH_RESTART_DELAY_MS, 8000),
  serverPort: num(process.env.SERVER_PORT, 8080),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  solanaEnabled: bool(process.env.SOLANA_ENABLED, false),
  solanaKeypairPath: process.env.SOLANA_KEYPAIR_PATH ?? './solana-keypair.json',
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  solanaTopupTreasuryWallet: process.env.SOLANA_TOPUP_TREASURY_WALLET ?? process.env.TOPUP_TREASURY_WALLET ?? '',
  txoddsApiUrl: process.env.TXODDS_API_URL ?? '',
  txoddsScoresApiUrl: process.env.TXODDS_SCORES_API_URL ?? '',
  txoddsApiKey: process.env.TXODDS_API_KEY ?? '',
  txoddsBearerToken: process.env.TXODDS_BEARER_TOKEN ?? '',
  txoddsMode: (process.env.TXODDS_MODE as TxOddsMode) ?? 'auto',
  txoddsPollMs: num(process.env.TXODDS_POLL_MS, 1000),
  txoddsMatchId: process.env.TXODDS_MATCH_ID ?? '',
  txoddsApiKeyHeader: process.env.TXODDS_API_KEY_HEADER ?? 'Authorization',
  txoddsApiKeyPrefix: process.env.TXODDS_API_KEY_PREFIX ?? 'Bearer',
  txoddsSubscribeMessage: process.env.TXODDS_SUBSCRIBE_MESSAGE ?? '',
  txoddsPayloadPath: process.env.TXODDS_PAYLOAD_PATH ?? '',
  txoddsMinutePath: process.env.TXODDS_MINUTE_PATH ?? '',
  txoddsTsPath: process.env.TXODDS_TS_PATH ?? '',
  txoddsOddsHomePath: process.env.TXODDS_ODDS_HOME_PATH ?? '',
  txoddsOddsDrawPath: process.env.TXODDS_ODDS_DRAW_PATH ?? '',
  txoddsOddsAwayPath: process.env.TXODDS_ODDS_AWAY_PATH ?? '',
  txoddsEventTypePath: process.env.TXODDS_EVENT_TYPE_PATH ?? '',
  txoddsEventTeamPath: process.env.TXODDS_EVENT_TEAM_PATH ?? '',
  txoddsHomeTeamName: process.env.TXODDS_HOME_TEAM_NAME ?? '',
  txoddsAwayTeamName: process.env.TXODDS_AWAY_TEAM_NAME ?? '',
} as const;

export type AppConfig = typeof config;
