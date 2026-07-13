import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  MATCH_ID,
  TEAM_NAMES,
  flagAssetForTeam as sharedFlagAssetForTeam,
  type AccountProfile,
  type DailyQuestState,
  type LiveDashboard,
  type LivePredictionState,
  type LiveRaidRow,
  type LiveRaidState,
  type LiveUpcomingMatch,
  type MatchInfo,
  type MatchPhase,
  type PredictionOptionId,
  type Probs,
  type RoomStatePublic,
} from '@fan-raid/shared';
import type { AppConfig } from '../config.js';
import type { Db } from '../persist/db.js';
import { signToken, verifyToken } from './token.js';
import { telegramDisplayName, validateInitData } from './telegram.js';
import { createWalletChallenge, verifyWalletChallenge } from './walletAuth.js';
import { coinTopupOption, getCoinTopupConfig, verifySolTopup } from './coinTopup.js';
import { listTxLineFixtures } from '../feed/TxLineDiscovery.js';

const DEFAULT_AVATAR_DIR = fileURLToPath(new URL('../../uploads/avatars', import.meta.url));
const AVATAR_MAX_BYTES = 1_500_000;
const AVATAR_MIME_TO_EXT: Record<string, 'png' | 'jpg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface RoutesDeps {
  config: AppConfig;
  db: Db;
  getPhase: () => MatchPhase;
  getMinute: () => number;
  getMatchInfo: () => MatchInfo | null;
  getLiveSnapshot: (playerId?: string) => RoomStatePublic | null;
}

export function registerRoutes(app: FastifyInstance, deps: RoutesDeps): void {
  const { config, db } = deps;
  const avatarDir = config.uploadsDir || DEFAULT_AVATAR_DIR;
  const predictionRewardCoins = 100;
  const dailyQuestId = 'daily-3-predictions';
  const dailyQuestTarget = 3;
  const dailyQuestRewardCoins = 200;
  let upcomingCache: { activeExternalId: string | null; expiresAt: number; matches: LiveUpcomingMatch[] } | null = null;

  function signAccount(account: AccountProfile): string {
    return signToken(
      {
        playerId: account.playerId,
        name: account.name,
        avatarUrl: account.avatarUrl,
        walletAddress: account.walletAddress,
        iat: Date.now(),
      },
      config.sessionSecret,
    );
  }

  function accountWithToken(account: AccountProfile): AccountProfile & { token: string } {
    return { ...account, token: signAccount(account) };
  }

  function authAccount(req: FastifyRequest): AccountProfile | null {
    const auth = req.headers.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!token) return null;

    const session = verifyToken(token, config.sessionSecret);
    if (!session) return null;

    const account = db.getPlayer(session.playerId);
    if (!account) return null;

    return {
      ...account,
      authMethod: account.walletAddress ? 'wallet' : session.playerId.startsWith('tg:') ? 'telegram' : 'dev',
    };
  }

  app.post('/api/auth/telegram', async (req, reply) => {
    const body = req.body as { initData?: string } | undefined;
    const initData = body?.initData ?? '';
    const user = validateInitData(initData, config.telegramBotToken);
    if (!user) {
      return reply.status(401).send({ error: 'invalid initData' });
    }

    const playerId = `tg:${user.id}`;
    const name = telegramDisplayName(user);
    const account = db.upsertPlayer(playerId, name, String(user.id), 'telegram');
    return accountWithToken(account);
  });

  app.post('/api/auth/dev', async (req, reply) => {
    if (!config.devMode) {
      return reply.status(403).send({ error: 'dev auth disabled' });
    }

    const body = req.body as { name?: string } | undefined;
    const name = (body?.name ?? '').trim() || `Guest-${Math.floor(Math.random() * 1000)}`;
    const playerId = `dev:${randomUUID()}`;
    const account = db.upsertPlayer(playerId, name, null, 'dev');
    return accountWithToken(account);
  });

  app.post('/api/auth/wallet/challenge', async (req, reply) => {
    const body = req.body as { walletAddress?: string; wallet?: string } | undefined;
    const walletAddress = body?.walletAddress ?? body?.wallet ?? '';
    try {
      return createWalletChallenge(walletAddress);
    } catch {
      return reply.status(400).send({ error: 'invalid wallet address' });
    }
  });

  app.post('/api/auth/wallet/verify', async (req, reply) => {
    const body = req.body as { walletAddress?: string; wallet?: string; message?: string; signature?: string } | undefined;
    const walletAddress = body?.walletAddress ?? body?.wallet ?? '';
    const message = body?.message ?? '';
    const signature = body?.signature ?? '';

    try {
      const verifiedWallet = verifyWalletChallenge(walletAddress, message, signature);
      if (!verifiedWallet) return reply.status(401).send({ error: 'invalid wallet signature' });

      const account = db.upsertWalletPlayer(verifiedWallet);
      return accountWithToken(account);
    } catch {
      return reply.status(400).send({ error: 'invalid wallet auth payload' });
    }
  });

  app.get('/api/account/me', async (req, reply) => {
    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });
    return account;
  });

  app.get('/api/account/profile', async (req, reply) => {
    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });
    return db.playerProfile(account);
  });

  app.post('/api/account/avatar', { bodyLimit: 3 * 1024 * 1024 }, async (req, reply) => {
    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });

    const body = req.body as { dataUrl?: string } | undefined;
    const parsed = parseAvatarDataUrl(body?.dataUrl ?? '');
    if (!parsed) return reply.status(400).send({ error: 'invalid avatar image' });

    const { buffer, ext } = parsed;
    if (buffer.length > AVATAR_MAX_BYTES) return reply.status(413).send({ error: 'avatar too large' });

    await mkdir(avatarDir, { recursive: true });
    const fileName = `${safeFilePart(account.playerId)}-${Date.now()}.${ext}`;
    const filePath = join(avatarDir, fileName);
    await writeFile(filePath, buffer);

    const updated = db.updatePlayerAvatar(account.playerId, `/uploads/avatars/${fileName}`);
    if (!updated) return reply.status(404).send({ error: 'account not found' });
    return accountWithToken({ ...updated, authMethod: account.authMethod });
  });

  app.post('/api/account/cards/claim', async (req, reply) => {
    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });

    const card = db.claimLatestCard(account.playerId);
    if (!card) return reply.status(404).send({ error: 'no claimable match result' });
    return { card, profile: db.playerProfile(account) };
  });

  app.get('/api/live/dashboard', async (req) => {
    const account = authAccount(req);
    return liveDashboard(account);
  });

  app.post('/api/live/prediction', async (req, reply) => {
    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });

    const body = req.body as { optionId?: PredictionOptionId } | undefined;
    const optionId = body?.optionId;
    if (optionId !== 'home' && optionId !== 'draw' && optionId !== 'away') {
      return reply.status(400).send({ error: 'invalid prediction option' });
    }

    const match = deps.getMatchInfo();
    if (!match) return reply.status(503).send({ error: 'live match unavailable' });

    const questionId = firstPredictionQuestionId(match);
    const result = db.recordLivePrediction({
      playerId: account.playerId,
      matchId: match.id,
      questionId,
      optionId,
      rewardCoins: predictionRewardCoins,
    });
    const updatedAccount = result.account ? { ...result.account, authMethod: account.authMethod } : account;
    return {
      created: result.created,
      account: updatedAccount,
      dashboard: await liveDashboard(updatedAccount),
    };
  });

  app.post('/api/live/daily/claim', async (req, reply) => {
    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });

    const daily = dailyQuestFor(account.playerId);
    if (!daily.claimable) {
      return reply.status(409).send({ error: daily.claimed ? 'daily already claimed' : 'daily not completed', dashboard: await liveDashboard(account) });
    }

    const today = questDay();
    const result = db.claimDailyQuest({
      playerId: account.playerId,
      questDate: today.date,
      questId: dailyQuestId,
      rewardCoins: dailyQuestRewardCoins,
    });
    const updatedAccount = result.account ? { ...result.account, authMethod: account.authMethod } : account;
    return {
      claimed: result.claimed,
      account: updatedAccount,
      dashboard: await liveDashboard(updatedAccount),
    };
  });

  app.post('/api/account/coins/spend', async (req, reply) => {
    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });

    const body = req.body as { amount?: number } | undefined;
    const amount = Number(body?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return reply.status(400).send({ error: 'invalid amount' });

    const updated = db.spendCoins(account.playerId, amount);
    if (!updated) return reply.status(402).send({ error: 'not enough coins' });
    return { ...updated, authMethod: account.authMethod };
  });

  app.post('/api/account/coins/grant', async (req, reply) => {
    if (!config.devMode) return reply.status(403).send({ error: 'coin grant disabled' });

    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });

    const body = req.body as { amount?: number } | undefined;
    const amount = Number(body?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return reply.status(400).send({ error: 'invalid amount' });

    const updated = db.addCoins(account.playerId, amount);
    if (!updated) return reply.status(404).send({ error: 'account not found' });
    return { ...updated, authMethod: account.authMethod };
  });

  app.get('/api/account/coins/topup/options', async (req, reply) => {
    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });
    try {
      return getCoinTopupConfig(config);
    } catch (err) {
      return reply.status(503).send({ error: err instanceof Error ? err.message : 'topup unavailable' });
    }
  });

  app.post('/api/account/coins/topup/verify', async (req, reply) => {
    const account = authAccount(req);
    if (!account) return reply.status(401).send({ error: 'unauthorized' });
    if (!account.walletAddress) return reply.status(400).send({ error: 'wallet account required' });

    const body = req.body as { packageId?: string; signature?: string } | undefined;
    const packageId = body?.packageId ?? '';
    const signature = (body?.signature ?? '').trim();
    const option = coinTopupOption(packageId);
    if (!option) return reply.status(400).send({ error: 'invalid topup package' });
    if (!signature) return reply.status(400).send({ error: 'missing signature' });

    let topupConfig;
    try {
      topupConfig = getCoinTopupConfig(config);
    } catch (err) {
      return reply.status(503).send({ error: err instanceof Error ? err.message : 'topup unavailable' });
    }

    const verified = await verifySolTopup({
      rpcUrl: topupConfig.rpcUrl,
      signature,
      payerWallet: account.walletAddress,
      treasuryWallet: topupConfig.treasuryWallet,
      lamports: option.lamports,
    });
    if (!verified.ok) return reply.status(400).send({ error: verified.reason });

    const updated = db.recordCoinTopup({
      signature,
      playerId: account.playerId,
      walletAddress: account.walletAddress,
      packageId: option.id,
      lamports: option.lamports,
      coins: option.coins,
      createdAt: Date.now(),
    });
    if (!updated) return reply.status(409).send({ error: 'topup already credited' });

    return { ...updated, authMethod: account.authMethod, creditedCoins: option.coins, signature, slot: verified.slot };
  });

  app.get('/api/match', async () => {
    const match = deps.getMatchInfo();
    return {
      matchId: match?.id ?? MATCH_ID,
      match,
      phase: deps.getPhase(),
      minute: deps.getMinute(),
      teams: match?.teams ?? { home: TEAM_NAMES.home, away: TEAM_NAMES.away },
    };
  });

  app.get('/api/match/leaderboard', async (req) => {
    const periodRaw = (req.query as { period?: string }).period;
    const period = periodRaw === 'today' || periodRaw === 'week' || periodRaw === 'all' ? periodRaw : 'all';
    return { period, top: db.topLeaderboard(50, period) };
  });

  app.get('/uploads/avatars/:file', async (req, reply) => {
    const file = (req.params as { file?: string }).file ?? '';
    if (!/^[a-z0-9._-]+\.(png|jpg|webp)$/i.test(file)) return reply.status(404).send({ error: 'not found' });

    try {
      const buffer = await readFile(join(avatarDir, file));
      const ext = extname(file).toLowerCase();
      const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      return reply.type(type).send(buffer);
    } catch {
      return reply.status(404).send({ error: 'not found' });
    }
  });

  app.get('/api/health', async () => ({ ok: true }));

  async function liveDashboard(account: AccountProfile | null): Promise<LiveDashboard> {
    const match = deps.getMatchInfo();
    const snapshot = deps.getLiveSnapshot(account?.playerId);
    return {
      upcoming: await upcomingMatches(match),
      prediction: predictionState(match, snapshot?.probs, account?.playerId),
      raid: raidState(snapshot, account?.playerId),
      daily: dailyQuestFor(account?.playerId),
    };
  }

  async function upcomingMatches(activeMatch: MatchInfo | null): Promise<LiveUpcomingMatch[]> {
    const now = Date.now();
    const activeExternalId = activeMatch?.externalId ?? null;
    if (upcomingCache && upcomingCache.expiresAt > now && upcomingCache.activeExternalId === activeExternalId) {
      return upcomingCache.matches;
    }

    try {
      const fixtures = await listTxLineFixtures(config);
      const matches = fixtures
        .filter((fixture) => fixture.fixtureId !== activeExternalId)
        .filter((fixture) => fixture.status === 'upcoming' || fixture.status === 'live')
        .slice(0, 3)
        .map((fixture): LiveUpcomingMatch => ({
          id: `txline-${fixture.fixtureId}`,
          externalId: fixture.fixtureId,
          competition: fixture.competition,
          startsAt: fixture.startsAt,
          status: fixture.status,
          home: fixture.home,
          away: fixture.away,
          homeFlag: flagAssetForTeam(fixture.home),
          awayFlag: flagAssetForTeam(fixture.away),
        }));
      upcomingCache = { activeExternalId, expiresAt: now + 30_000, matches };
      return matches;
    } catch {
      const fallback = activeMatch ? [] : simulatedUpcoming();
      upcomingCache = { activeExternalId, expiresAt: now + 10_000, matches: fallback };
      return fallback;
    }
  }

  function predictionState(
    match: MatchInfo | null,
    probs: Probs | undefined,
    playerId: string | undefined,
  ): LivePredictionState {
    const safeMatch = match ?? {
      id: MATCH_ID,
      teams: { home: TEAM_NAMES.home, away: TEAM_NAMES.away },
      source: 'sim' as const,
      isReal: false,
    };
    const questionId = firstPredictionQuestionId(safeMatch);
    const selected = playerId ? db.getLivePrediction(playerId, safeMatch.id, questionId) : null;
    const fallbackProbs = probs ?? { home: 0.4, draw: 0.26, away: 0.34 };
    const startsAt = safeMatch.startsAt ? Date.parse(safeMatch.startsAt) : Number.NaN;
    const closesAt = Number.isFinite(startsAt) && startsAt > Date.now() ? startsAt : Date.now() + 60 * 60_000;

    return {
      questionId,
      title: 'Who scores first?',
      closesAt,
      rewardCoins: predictionRewardCoins,
      options: [
        { id: 'home', label: safeMatch.teams.home, odds: decimalOdds(fallbackProbs.home), flag: flagAssetForTeam(safeMatch.teams.home) },
        { id: 'draw', label: 'Nobody', odds: decimalOdds(fallbackProbs.draw), flag: '×' },
        { id: 'away', label: safeMatch.teams.away, odds: decimalOdds(fallbackProbs.away), flag: flagAssetForTeam(safeMatch.teams.away) },
      ],
      selectedOptionId: selected?.option_id,
      submittedAt: selected?.created_at,
    };
  }

  function raidState(snapshot: RoomStatePublic | null, playerId: string | undefined): LiveRaidState {
    const rows: LiveRaidRow[] = (snapshot?.players ?? [])
      .slice()
      .sort((a, b) => b.points - a.points)
      .slice(0, 8)
      .map((player) => ({
        id: player.id,
        name: player.name,
        initials: initials(player.name),
        avatarUrl: player.avatarUrl,
        side: player.side,
        points: player.points,
        isMe: player.id === playerId,
      }));
    const totalPoints = rows.reduce((sum, row) => sum + row.points, 0);
    const targetPoints = 5000;
    return {
      targetPoints,
      totalPoints,
      progress: Math.min(100, Math.round((totalPoints / targetPoints) * 100)),
      participants: snapshot?.players.length ?? 0,
      rows,
    };
  }

  function dailyQuestFor(playerId: string | undefined): DailyQuestState {
    if (!playerId) {
      return {
        id: dailyQuestId,
        title: 'Make 3 predictions',
        target: dailyQuestTarget,
        progress: 0,
        rewardCoins: dailyQuestRewardCoins,
        claimed: false,
        claimable: false,
      };
    }

    const today = questDay();
    const progress = Math.min(dailyQuestTarget, db.dailyPredictionCount(playerId, today.start, today.end));
    const claimed = Boolean(db.getDailyQuestClaim(playerId, today.date, dailyQuestId));
    return {
      id: dailyQuestId,
      title: 'Make 3 predictions',
      target: dailyQuestTarget,
      progress,
      rewardCoins: dailyQuestRewardCoins,
      claimed,
      claimable: progress >= dailyQuestTarget && !claimed,
    };
  }

  function firstPredictionQuestionId(match: MatchInfo): string {
    return `first-goal:${match.id}`;
  }

  function decimalOdds(probability: number): number {
    if (!Number.isFinite(probability) || probability <= 0.01) return 9.99;
    const normalized = Math.max(1.01, Math.min(12, 1 / probability));
    return Math.round(normalized * 100) / 100;
}

function parseAvatarDataUrl(value: string): { buffer: Buffer; ext: 'png' | 'jpg' | 'webp' } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return null;
  const mime = match[1]!;
  const ext = AVATAR_MIME_TO_EXT[mime];
  if (!ext) return null;
  const base64 = match[2]!.replace(/\s/g, '');
  const buffer = Buffer.from(base64, 'base64');
  return buffer.length > 0 ? { buffer, ext } : null;
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'player';
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const source = parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2);
    return (source.toUpperCase() || 'FR').slice(0, 2);
  }

  function questDay(now = Date.now()): { date: string; start: number; end: number } {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      start: start.getTime(),
      end: end.getTime(),
    };
  }

  function simulatedUpcoming(): LiveUpcomingMatch[] {
    const now = Date.now();
    return [
      simulatedUpcomingMatch(0, 'Spain', 'Colombia', now + 3 * 60 * 60_000),
      simulatedUpcomingMatch(1, 'Argentina', 'Uruguay', now + 6 * 60 * 60_000),
      simulatedUpcomingMatch(2, 'Brazil', 'Chile', now + 25 * 60 * 60_000),
    ];
  }

  function simulatedUpcomingMatch(index: number, home: string, away: string, startMs: number): LiveUpcomingMatch {
    return {
      id: `sim-upcoming-${index}`,
      competition: 'Friendlies',
      startsAt: new Date(startMs).toISOString(),
      status: 'upcoming',
      home,
      away,
      homeFlag: flagAssetForTeam(home),
      awayFlag: flagAssetForTeam(away),
    };
  }

  function flagAssetForTeam(name: string): string {
    return sharedFlagAssetForTeam(name);
  }

  function legacyFlagAssetForTeam(name: string): string {
    const normalized = name.toLowerCase();
    const code =
      normalized.includes('vietnam') || normalized.includes('вьет') ? 'VN' :
      normalized.includes('myanmar') || normalized.includes('мьян') ? 'MM' :
      normalized.includes('spain') || normalized.includes('испан') ? 'ES' :
      normalized.includes('colombia') || normalized.includes('колум') ? 'CO' :
      normalized.includes('argentina') || normalized.includes('аргент') ? 'AR' :
      normalized.includes('uruguay') || normalized.includes('уруг') ? 'UY' :
      normalized.includes('brazil') || normalized.includes('браз') ? 'BR' :
      normalized.includes('chile') || normalized.includes('чили') ? 'CL' :
      normalized.includes('france') || normalized.includes('франц') ? 'FR' :
      normalized.includes('germany') || normalized.includes('герман') ? 'DE' :
      normalized.includes('england') || normalized.includes('англ') ? 'GB' :
      normalized.includes('italy') || normalized.includes('итал') ? 'IT' :
      normalized.includes('portugal') || normalized.includes('порту') ? 'PT' :
      normalized.includes('netherlands') || normalized.includes('нидер') ? 'NL' :
      normalized.includes('usa') || normalized.includes('united states') || normalized.includes('сша') ? 'US' :
      undefined;
    return code ? flagUrlForCode(code) : '🏳️';
  }

  function flagUrlForCode(code: string): string {
    return `https://flagcdn.com/w160/${code.toLowerCase()}.png`;
  }
}
