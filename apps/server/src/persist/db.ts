import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AnswerLogRow } from '../engine/settlement.js';
import {
  achievementProgressForStats,
  type AccountProfile,
  type ClaimableMatchResult,
  type MatchSummary,
  type PlayerAchievement,
  type PlayerCard,
  type PlayerCardRarity,
  type PlayerMatchResultSource,
  type PlayerProfile,
  type PlayerStats,
  type PredictionOptionId,
  type TeamSide,
} from '@fan-raid/shared';

const STARTING_COINS = 5000;

interface PlayerRow {
  id: string;
  tg_id: string | null;
  wallet_address: string | null;
  name: string;
  avatar_url: string | null;
  coin_balance: number;
  created_at: number;
}

interface MatchResultRow {
  match_id: string;
  player_id: string;
  side: TeamSide;
  points: number;
  best_streak: number;
  damage: number;
  accuracy: number;
  source: PlayerMatchResultSource;
  created_at: number;
}

type LeaderboardPeriod = 'today' | 'week' | 'all';

interface PlayerCardRow {
  id: string;
  player_id: string;
  match_id: string;
  source: PlayerMatchResultSource;
  title: string;
  subtitle: string;
  rarity: PlayerCardRarity;
  side: TeamSide;
  points: number;
  best_streak: number;
  accuracy: number;
  claimed_at: number;
}

interface LivePredictionRow {
  player_id: string;
  match_id: string;
  question_id: string;
  option_id: PredictionOptionId;
  reward_coins: number;
  created_at: number;
}

interface DailyQuestClaimRow {
  player_id: string;
  quest_date: string;
  quest_id: string;
  reward_coins: number;
  claimed_at: number;
}

interface PlayerAchievementRow {
  player_id: string;
  achievement_id: string;
  earned_at: number;
}

export interface CoinTopupRow {
  signature: string;
  playerId: string;
  walletAddress: string;
  packageId: string;
  lamports: number;
  coins: number;
  createdAt: number;
}

// SQLite persistence (section 11). Match state lives in memory;
// the DB stores players, results, and the answer log.
export class Db {
  private db: Database.Database;

  constructor(path = './fan-raid.sqlite') {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        tg_id TEXT,
        wallet_address TEXT,
        name TEXT NOT NULL,
        avatar_url TEXT,
        coin_balance INTEGER NOT NULL DEFAULT ${STARTING_COINS},
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS match_results (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'live',
        side TEXT NOT NULL,
        points INTEGER NOT NULL,
        best_streak INTEGER NOT NULL,
        damage INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, player_id)
      );
      CREATE TABLE IF NOT EXISTS player_cards (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        match_id TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL,
        rarity TEXT NOT NULL,
        side TEXT NOT NULL,
        points INTEGER NOT NULL,
        best_streak INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        claimed_at INTEGER NOT NULL,
        UNIQUE (player_id, match_id)
      );
      CREATE TABLE IF NOT EXISTS live_predictions (
        player_id TEXT NOT NULL,
        match_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        option_id TEXT NOT NULL,
        reward_coins INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, match_id, question_id)
      );
      CREATE TABLE IF NOT EXISTS daily_quest_claims (
        player_id TEXT NOT NULL,
        quest_date TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        reward_coins INTEGER NOT NULL,
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, quest_date, quest_id)
      );
      CREATE TABLE IF NOT EXISTS player_achievements (
        player_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        earned_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, achievement_id)
      );
      CREATE TABLE IF NOT EXISTS answers (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        option INTEGER NOT NULL,
        result TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coin_topups (
        signature TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        package_id TEXT NOT NULL,
        lamports INTEGER NOT NULL,
        coins INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_answers_match ON answers(match_id);
      CREATE INDEX IF NOT EXISTS idx_coin_topups_player ON coin_topups(player_id);
      CREATE INDEX IF NOT EXISTS idx_match_results_player ON match_results(player_id);
      CREATE INDEX IF NOT EXISTS idx_player_cards_player ON player_cards(player_id);
      CREATE INDEX IF NOT EXISTS idx_live_predictions_player_day ON live_predictions(player_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_daily_claims_player ON daily_quest_claims(player_id, quest_date);
      CREATE INDEX IF NOT EXISTS idx_player_achievements_player ON player_achievements(player_id, earned_at);
    `);
    this.ensurePlayerColumn('wallet_address', 'TEXT');
    this.ensurePlayerColumn('avatar_url', 'TEXT');
    this.ensurePlayerColumn('coin_balance', `INTEGER NOT NULL DEFAULT ${STARTING_COINS}`);
    this.ensureTableColumn('match_results', 'source', "TEXT NOT NULL DEFAULT 'live'");
    this.ensureTableColumn('match_results', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
    this.db.prepare('UPDATE match_results SET created_at = ? WHERE created_at = 0').run(Date.now());
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_players_wallet ON players(wallet_address) WHERE wallet_address IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_match_results_source ON match_results(source);
      CREATE INDEX IF NOT EXISTS idx_match_results_period ON match_results(source, created_at);
    `);
  }

  private ensurePlayerColumn(name: string, ddl: string): void {
    this.ensureTableColumn('players', name, ddl);
  }

  private ensureTableColumn(table: string, name: string, ddl: string): void {
    if (!/^[a-z_]+$/i.test(table) || !/^[a-z_]+$/i.test(name)) {
      throw new Error(`unsafe sqlite identifier: ${table}.${name}`);
    }
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    }
  }

  upsertPlayer(id: string, name: string, tgId: string | null, authMethod: AccountProfile['authMethod'] = 'dev'): AccountProfile {
    this.db
      .prepare(
        `INSERT INTO players (id, tg_id, wallet_address, name, coin_balance, created_at) VALUES (?, ?, NULL, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, tg_id = excluded.tg_id`,
      )
      .run(id, tgId, name, STARTING_COINS, Date.now());
    const account = this.getPlayer(id);
    if (!account) throw new Error(`player was not persisted: ${id}`);
    return { ...account, authMethod };
  }

  upsertWalletPlayer(walletAddress: string): AccountProfile {
    const id = `wallet:${walletAddress}`;
    const name = walletDisplayName(walletAddress);
    this.db
      .prepare(
        `INSERT INTO players (id, tg_id, wallet_address, name, coin_balance, created_at) VALUES (?, NULL, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET wallet_address = excluded.wallet_address, name = excluded.name`,
      )
      .run(id, walletAddress, name, STARTING_COINS, Date.now());
    const account = this.getPlayer(id);
    if (!account) throw new Error(`wallet player was not persisted: ${walletAddress}`);
    return { ...account, authMethod: 'wallet' };
  }

  getPlayer(id: string): Omit<AccountProfile, 'authMethod'> | null {
    const row = this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
    return row ? rowToAccount(row) : null;
  }

  spendCoins(playerId: string, amount: number): Omit<AccountProfile, 'authMethod'> | null {
    const normalized = normalizeCoinAmount(amount);
    const tx = this.db.transaction((id: string) => {
      const current = this.getPlayer(id);
      if (!current || current.coins < normalized) return null;
      this.db.prepare('UPDATE players SET coin_balance = coin_balance - ? WHERE id = ?').run(normalized, id);
      return this.getPlayer(id);
    });
    return tx(playerId);
  }

  addCoins(playerId: string, amount: number): Omit<AccountProfile, 'authMethod'> | null {
    const normalized = normalizeCoinAmount(amount);
    this.db.prepare('UPDATE players SET coin_balance = coin_balance + ? WHERE id = ?').run(normalized, playerId);
    return this.getPlayer(playerId);
  }

  updatePlayerAvatar(playerId: string, avatarUrl: string): Omit<AccountProfile, 'authMethod'> | null {
    this.db.prepare('UPDATE players SET avatar_url = ? WHERE id = ?').run(avatarUrl, playerId);
    return this.getPlayer(playerId);
  }

  recordCoinTopup(row: CoinTopupRow): Omit<AccountProfile, 'authMethod'> | null {
    const tx = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT signature FROM coin_topups WHERE signature = ?').get(row.signature);
      if (existing) return null;

      this.db
        .prepare(
          `INSERT INTO coin_topups (signature, player_id, wallet_address, package_id, lamports, coins, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(row.signature, row.playerId, row.walletAddress, row.packageId, row.lamports, row.coins, row.createdAt);
      this.db.prepare('UPDATE players SET coin_balance = coin_balance + ? WHERE id = ?').run(row.coins, row.playerId);
      return this.getPlayer(row.playerId);
    });
    return tx();
  }

  getLivePrediction(playerId: string, matchId: string, questionId: string): LivePredictionRow | null {
    const row = this.db
      .prepare('SELECT * FROM live_predictions WHERE player_id = ? AND match_id = ? AND question_id = ?')
      .get(playerId, matchId, questionId) as LivePredictionRow | undefined;
    return row ?? null;
  }

  recordLivePrediction(args: {
    playerId: string;
    matchId: string;
    questionId: string;
    optionId: PredictionOptionId;
    rewardCoins: number;
  }): { created: boolean; prediction: LivePredictionRow; account: Omit<AccountProfile, 'authMethod'> | null } {
    const tx = this.db.transaction(() => {
      const existing = this.getLivePrediction(args.playerId, args.matchId, args.questionId);
      if (existing) return { created: false, prediction: existing, account: this.getPlayer(args.playerId) };

      const createdAt = Date.now();
      this.db
        .prepare(
          `INSERT INTO live_predictions (player_id, match_id, question_id, option_id, reward_coins, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(args.playerId, args.matchId, args.questionId, args.optionId, args.rewardCoins, createdAt);
      this.db
        .prepare('UPDATE players SET coin_balance = coin_balance + ? WHERE id = ?')
        .run(args.rewardCoins, args.playerId);

      const prediction = this.getLivePrediction(args.playerId, args.matchId, args.questionId);
      if (!prediction) throw new Error('live prediction was not persisted');
      return { created: true, prediction, account: this.getPlayer(args.playerId) };
    });
    return tx();
  }

  dailyPredictionCount(playerId: string, dayStart: number, dayEnd: number): number {
    const livePredictionRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM live_predictions
         WHERE player_id = ? AND created_at >= ? AND created_at < ?`,
      )
      .get(playerId, dayStart, dayEnd) as { count: number } | undefined;
    const answerRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM answers
         WHERE player_id = ? AND ts >= ? AND ts < ?`,
      )
      .get(playerId, dayStart, dayEnd) as { count: number } | undefined;
    return Number(livePredictionRow?.count ?? 0) + Number(answerRow?.count ?? 0);
  }

  getDailyQuestClaim(playerId: string, questDate: string, questId: string): DailyQuestClaimRow | null {
    const row = this.db
      .prepare('SELECT * FROM daily_quest_claims WHERE player_id = ? AND quest_date = ? AND quest_id = ?')
      .get(playerId, questDate, questId) as DailyQuestClaimRow | undefined;
    return row ?? null;
  }

  claimDailyQuest(args: {
    playerId: string;
    questDate: string;
    questId: string;
    rewardCoins: number;
  }): { claimed: boolean; account: Omit<AccountProfile, 'authMethod'> | null } {
    const tx = this.db.transaction(() => {
      const existing = this.getDailyQuestClaim(args.playerId, args.questDate, args.questId);
      if (existing) return { claimed: false, account: this.getPlayer(args.playerId) };

      this.db
        .prepare(
          `INSERT INTO daily_quest_claims (player_id, quest_date, quest_id, reward_coins, claimed_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(args.playerId, args.questDate, args.questId, args.rewardCoins, Date.now());
      this.db
        .prepare('UPDATE players SET coin_balance = coin_balance + ? WHERE id = ?')
        .run(args.rewardCoins, args.playerId);
      return { claimed: true, account: this.getPlayer(args.playerId) };
    });
    return tx();
  }

  insertAnswer(matchId: string, row: AnswerLogRow): void {
    this.db
      .prepare(
        `INSERT INTO answers (match_id, player_id, question_id, option, result, ts)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(matchId, row.playerId, row.questionId, row.option, row.result, row.ts);
  }

  saveMatchResults(summary: MatchSummary, source: PlayerMatchResultSource = 'live'): void {
    const stmt = this.db.prepare(
      `INSERT INTO match_results (match_id, player_id, source, side, points, best_streak, damage, accuracy, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(match_id, player_id) DO UPDATE SET
         source=excluded.source,
         points=excluded.points, best_streak=excluded.best_streak,
         damage=excluded.damage, accuracy=excluded.accuracy,
         created_at=excluded.created_at`,
    );
    const tx = this.db.transaction((rows: MatchSummary['players']) => {
      const createdAt = Date.now();
      for (const p of rows) {
        stmt.run(summary.matchId, p.id, source, p.side, p.points, p.bestStreak, p.impact, p.accuracy, createdAt);
      }
    });
    tx(summary.players);
  }

  // Top 50 by total points for the selected period (section 11: GET /api/match/leaderboard).
  topLeaderboard(limit = 50, period: LeaderboardPeriod = 'all'): Array<{ playerId: string; name: string; avatarUrl?: string; side: TeamSide; points: number }> {
    const periodStart = this.leaderboardPeriodStart(period);
    const wherePeriod = periodStart ? 'AND mr.created_at >= ?' : '';
    const params = periodStart ? [periodStart, limit] : [limit];
    const rows = this.db
      .prepare(
        `SELECT p.id AS playerId, p.name AS name, p.avatar_url AS avatarUrl, mr.side AS side, SUM(mr.points) AS points
         FROM match_results mr JOIN players p ON p.id = mr.player_id
         WHERE mr.source = 'live' ${wherePeriod}
         GROUP BY p.id, p.name, p.avatar_url, mr.side ORDER BY points DESC LIMIT ?`,
      )
      .all(...params) as Array<{ playerId: string; name: string; avatarUrl?: string | null; side: TeamSide; points: number }>;
    return rows.map((row) => ({ ...row, avatarUrl: row.avatarUrl ?? undefined }));
  }

  private leaderboardPeriodStart(period: LeaderboardPeriod): number | null {
    if (period === 'all') return null;
    const now = new Date();
    if (period === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    }
    return Date.now() - 7 * 24 * 60 * 60_000;
  }

  playerProfile(account: AccountProfile): PlayerProfile {
    const stats = this.playerStats(account.playerId);
    const cards = this.playerCards(account.playerId);
    const achievementState = this.playerAchievements(account.playerId, stats);
    return {
      account,
      stats,
      cards,
      achievements: achievementState.achievements,
      newAchievements: achievementState.newAchievements,
      claimable: this.latestClaimableResult(account.playerId),
    };
  }

  playerAchievements(playerId: string, stats: PlayerStats): { achievements: PlayerAchievement[]; newAchievements: PlayerAchievement[] } {
    const existingRows = this.db
      .prepare('SELECT * FROM player_achievements WHERE player_id = ?')
      .all(playerId) as PlayerAchievementRow[];
    const earnedAtById = new Map(existingRows.map((row) => [row.achievement_id, row.earned_at] as const));
    const progress = achievementProgressForStats(stats);
    const newAchievements: PlayerAchievement[] = [];
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO player_achievements (player_id, achievement_id, earned_at)
       VALUES (?, ?, ?)`,
    );

    for (const item of progress) {
      if (!item.qualified || earnedAtById.has(item.id)) continue;
      insert.run(playerId, item.id, now);
      earnedAtById.set(item.id, now);
      const { qualified: _qualified, ...achievement } = item;
      newAchievements.push({ ...achievement, earnedAt: now });
    }

    const achievements = progress
      .filter((item) => item.qualified || earnedAtById.has(item.id))
      .map((item) => {
        const { qualified: _qualified, ...achievement } = item;
        return { ...achievement, earnedAt: earnedAtById.get(item.id) ?? now };
      })
      .sort((a, b) => b.earnedAt - a.earnedAt);

    return { achievements, newAchievements };
  }

  playerStats(playerId: string): PlayerStats {
    const result = this.db
      .prepare(
        `SELECT
           COUNT(*) AS matchesPlayed,
           COALESCE(SUM(points), 0) AS totalPoints,
           COALESCE(MAX(best_streak), 0) AS bestStreak,
           COALESCE(AVG(accuracy), 0) AS averageAccuracy
         FROM match_results
         WHERE player_id = ?`,
      )
      .get(playerId) as Omit<PlayerStats, 'cardsClaimed'> | undefined;
    const cards = this.db
      .prepare('SELECT COUNT(*) AS count FROM player_cards WHERE player_id = ?')
      .get(playerId) as { count: number } | undefined;

    return {
      matchesPlayed: Number(result?.matchesPlayed ?? 0),
      totalPoints: Number(result?.totalPoints ?? 0),
      bestStreak: Number(result?.bestStreak ?? 0),
      averageAccuracy: Number(result?.averageAccuracy ?? 0),
      cardsClaimed: Number(cards?.count ?? 0),
    };
  }

  playerCards(playerId: string): PlayerCard[] {
    const rows = this.db
      .prepare('SELECT * FROM player_cards WHERE player_id = ? ORDER BY claimed_at DESC')
      .all(playerId) as PlayerCardRow[];
    return rows.map(rowToCard);
  }

  latestClaimableResult(playerId: string): ClaimableMatchResult | null {
    const row = this.db
      .prepare(
        `SELECT mr.*
         FROM match_results mr
         LEFT JOIN player_cards pc ON pc.player_id = mr.player_id AND pc.match_id = mr.match_id
         WHERE mr.player_id = ? AND pc.id IS NULL
         ORDER BY mr.rowid DESC
         LIMIT 1`,
      )
      .get(playerId) as MatchResultRow | undefined;
    return row ? rowToClaimable(row) : null;
  }

  claimLatestCard(playerId: string): PlayerCard | null {
    const tx = this.db.transaction((id: string) => {
      const row = this.db
        .prepare(
          `SELECT mr.*
           FROM match_results mr
           LEFT JOIN player_cards pc ON pc.player_id = mr.player_id AND pc.match_id = mr.match_id
           WHERE mr.player_id = ? AND pc.id IS NULL
           ORDER BY mr.rowid DESC
           LIMIT 1`,
        )
        .get(id) as MatchResultRow | undefined;
      if (!row) return null;

      const card = createCardFromResult(row);
      this.db
        .prepare(
          `INSERT INTO player_cards (
             id, player_id, match_id, source, title, subtitle, rarity,
             side, points, best_streak, accuracy, claimed_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          card.id,
          id,
          card.matchId,
          card.source,
          card.title,
          card.subtitle,
          card.rarity,
          card.side,
          card.points,
          card.bestStreak,
          card.accuracy,
          card.claimedAt,
        );
      return card;
    });
    return tx(playerId);
  }

  close(): void {
    this.db.close();
  }
}

function rowToAccount(row: PlayerRow): Omit<AccountProfile, 'authMethod'> {
  return {
    playerId: row.id,
    name: row.name,
    avatarUrl: row.avatar_url ?? undefined,
    walletAddress: row.wallet_address ?? undefined,
    coins: row.coin_balance,
  };
}

function rowToClaimable(row: MatchResultRow): ClaimableMatchResult {
  return {
    matchId: row.match_id,
    source: normalizeSource(row.source),
    side: row.side,
    points: row.points,
    bestStreak: row.best_streak,
    accuracy: row.accuracy,
  };
}

function rowToCard(row: PlayerCardRow): PlayerCard {
  return {
    id: row.id,
    matchId: row.match_id,
    source: normalizeSource(row.source),
    title: row.title,
    subtitle: row.subtitle,
    rarity: normalizeRarity(row.rarity),
    side: row.side,
    points: row.points,
    bestStreak: row.best_streak,
    accuracy: row.accuracy,
    claimedAt: row.claimed_at,
  };
}

function createCardFromResult(row: MatchResultRow): PlayerCard {
  const rarity = cardRarity(row.points, row.best_streak);
  const source = normalizeSource(row.source);
  const sideName = row.side === 'home' ? 'Home raid' : 'Away raid';
  const title = cardTitle(rarity);
  const subtitle = `${source === 'test' ? 'Test match' : 'Live match'} · ${sideName}`;
  const claimedAt = Date.now();

  return {
    id: `card:${row.player_id}:${row.match_id}`,
    matchId: row.match_id,
    source,
    title,
    subtitle,
    rarity,
    side: row.side,
    points: row.points,
    bestStreak: row.best_streak,
    accuracy: row.accuracy,
    claimedAt,
  };
}

function cardRarity(points: number, bestStreak: number): PlayerCardRarity {
  if (points >= 900 || bestStreak >= 8) return 'legendary';
  if (points >= 520 || bestStreak >= 5) return 'epic';
  if (points >= 220 || bestStreak >= 3) return 'rare';
  return 'common';
}

function cardTitle(rarity: PlayerCardRarity): string {
  switch (rarity) {
    case 'legendary':
      return 'Raid MVP';
    case 'epic':
      return 'Impact player';
    case 'rare':
      return 'Prediction streak';
    default:
      return 'Match card';
  }
}

function normalizeSource(source: string): PlayerMatchResultSource {
  return source === 'test' ? 'test' : 'live';
}

function normalizeRarity(rarity: string): PlayerCardRarity {
  if (rarity === 'legendary' || rarity === 'epic' || rarity === 'rare') return rarity;
  return 'common';
}

function walletDisplayName(walletAddress: string): string {
  return `Wallet ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
}

function normalizeCoinAmount(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.floor(amount));
}
