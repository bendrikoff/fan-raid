// ---------------------------------------------------------------------------
// Fan Raid — shared domain types (design doc sections 5, 6, 7).
// Game logic is fully decoupled from the data source: these types
// are used consistently by the live API, replay, and simulator.
// ---------------------------------------------------------------------------

export type TeamSide = 'home' | 'away';

// --- Normalized feed (section 5.2) ----------------------------------------

export interface Probs {
  home: number;
  draw: number;
  away: number;
}

export interface OddsUpdate {
  matchId: string;
  ts: number; // unix ms
  minute: number; // game minute
  probs: Probs; // sum = 1
}

export type MatchEventType =
  | 'kickoff'
  | 'shot'
  | 'shot_on_target'
  | 'corner'
  | 'yellow_card'
  | 'red_card'
  | 'goal'
  | 'score_update'
  | 'halftime'
  | 'second_half'
  | 'fulltime';

export interface MatchEvent {
  matchId: string;
  ts: number;
  minute: number;
  type: MatchEventType;
  team?: TeamSide; // absent for kickoff/halftime/fulltime
  score?: Score; // present for score_update snapshots from external feeds
}

export interface MatchInfo {
  id: string;
  externalId?: string;
  source: 'sim' | 'replay' | 'txodds';
  isReal: boolean;
  teams: Record<TeamSide, string>;
  competition?: string;
  startsAt?: string;
  status?: 'live' | 'upcoming' | 'finished' | 'unknown';
}

export type PredictionOptionId = TeamSide | 'draw';

export interface LiveUpcomingMatch {
  id: string;
  externalId?: string;
  competition?: string;
  startsAt?: string;
  status: MatchInfo['status'];
  home: string;
  away: string;
  homeFlag: string;
  awayFlag: string;
}

export interface LivePredictionOption {
  id: PredictionOptionId;
  label: string;
  odds: number;
  flag: string;
}

export interface LivePredictionState {
  questionId: string;
  title: string;
  closesAt: number;
  rewardCoins: number;
  options: LivePredictionOption[];
  selectedOptionId?: PredictionOptionId;
  submittedAt?: number;
}

export interface LiveRaidRow {
  id: string;
  name: string;
  initials: string;
  avatarUrl?: string;
  side: TeamSide;
  points: number;
  isMe: boolean;
}

export interface LiveRaidState {
  targetPoints: number;
  totalPoints: number;
  progress: number;
  participants: number;
  rows: LiveRaidRow[];
}

export interface DailyQuestState {
  id: string;
  title: string;
  target: number;
  progress: number;
  rewardCoins: number;
  claimed: boolean;
  claimable: boolean;
}

export interface LiveDashboard {
  upcoming: LiveUpcomingMatch[];
  prediction: LivePredictionState;
  raid: LiveRaidState;
  daily: DailyQuestState;
}

// JSONL replay row (section 5.4).
export type ReplayRecord =
  | { kind: 'odds'; payload: OddsUpdate }
  | { kind: 'match'; payload: MatchEvent };

// --- Questions (section 7) ------------------------------------------------

export type QuestionTypeId =
  | 'NEXT_EVENT_TYPE'
  | 'NEXT_DANGER_TEAM'
  | 'GOAL_IN_WINDOW'
  | 'CARD_BEFORE_BREAK'
  | 'PROB_DELTA'
  | 'CORNER_BONUS';

export type QuestionPhase = 'created' | 'open' | 'locked' | 'resolved';

// Public question representation (what the client sees).
export interface QuestionPublic {
  id: string;
  typeId: QuestionTypeId;
  text: string;
  options: string[];
  createdAtMinute: number;
  closesAtMinute: number; // minute when the answer window closes
  isBonus: boolean;
}

export type AnswerResult = 'correct' | 'wrong' | 'missed' | 'void';

export interface AnswerRecord {
  questionId: string;
  optionIndex: number;
  result: AnswerResult | 'pending';
  ts: number;
}

// --- Room state (section 6) -----------------------------------------------

export type MatchPhase =
  | 'lobby'
  | 'first_half'
  | 'halftime'
  | 'second_half'
  | 'finished';

export interface Score {
  home: number;
  away: number;
}

export interface PlayerPublic {
  id: string;
  name: string;
  avatarUrl?: string;
  side: TeamSide;
  points: number;
  streak: number;
  bestStreak: number;
  // Accumulated player contribution to their side power (formerly boss damage).
  impact: number;
}

export interface AccountProfile {
  playerId: string;
  name: string;
  avatarUrl?: string;
  walletAddress?: string;
  coins: number;
  authMethod: 'telegram' | 'dev' | 'wallet';
}

export type PlayerMatchResultSource = 'live' | 'test';

export type PlayerCardRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface PlayerStats {
  matchesPlayed: number;
  totalPoints: number;
  bestStreak: number;
  averageAccuracy: number;
  cardsClaimed: number;
}

export interface PlayerAchievement {
  id: string;
  title: string;
  detail: string;
  image: string;
  progress: number;
  target: number;
  earnedAt: number;
}

export interface ClaimableMatchResult {
  matchId: string;
  source: PlayerMatchResultSource;
  side: TeamSide;
  points: number;
  bestStreak: number;
  accuracy: number;
}

export interface PlayerCard {
  id: string;
  matchId: string;
  source: PlayerMatchResultSource;
  title: string;
  subtitle: string;
  rarity: PlayerCardRarity;
  side: TeamSide;
  points: number;
  bestStreak: number;
  accuracy: number;
  claimedAt: number;
}

export interface PlayerProfile {
  account: AccountProfile;
  stats: PlayerStats;
  cards: PlayerCard[];
  achievements: PlayerAchievement[];
  newAchievements?: PlayerAchievement[];
  claimable: ClaimableMatchResult | null;
}

export interface ClaimCardResponse {
  card: PlayerCard;
  profile: PlayerProfile;
}

export interface CoinTopupOption {
  id: string;
  title: string;
  coins: number;
  lamports: number;
  sol: number;
  tag?: string;
}

export interface CoinTopupConfig {
  network: 'devnet' | 'mainnet-beta' | 'localnet';
  rpcUrl: string;
  treasuryWallet: string;
  options: CoinTopupOption[];
}

// Full public room snapshot (WS `state`).
export interface RoomStatePublic {
  matchId: string;
  match: MatchInfo;
  phase: MatchPhase;
  minute: number;
  score: Score;
  probs: Probs;
  fanPower: number; // 0..100, home share (section 8.3)
  activeQuestion: QuestionPublic | null;
  players: PlayerPublic[];
  you?: PlayerPublic; // personalized before sending
}

// --- Match summary (sections 8.4, 12) -------------------------------------

export interface LeaderboardEntry {
  playerId?: string;
  name: string;
  avatarUrl?: string;
  side: TeamSide;
  points: number;
}

export interface PlayerSummary {
  id: string;
  name: string;
  avatarUrl?: string;
  side: TeamSide;
  points: number;
  bestStreak: number;
  impact: number;
  accuracy: number; // 0..1
}

export interface MatchSummary {
  matchId: string;
  score: Score;
  winningSide: TeamSide | 'draw';
  // Raid winner is determined by the final Fan Power.
  raidWinner: TeamSide | 'draw';
  finalFanPower: number; // 0..100, home share at the final whistle
  totalImpact: { home: number; away: number };
  top10: LeaderboardEntry[];
  players: PlayerSummary[];
  answersLogSha256: string;
  chainSignature?: string | null; // Solana transaction signature, if enabled
}
