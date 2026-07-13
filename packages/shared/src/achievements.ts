import type { PlayerAchievement, PlayerStats } from './types.js';

export type AchievementProgress = Omit<PlayerAchievement, 'earnedAt'> & {
  qualified: boolean;
};

type AchievementRule = {
  id: string;
  title: string;
  image: string;
  target: number;
  progress: (stats: PlayerStats) => number;
  detail: (stats: PlayerStats) => string;
};

const ACHIEVEMENT_IMAGE_DIR = '/images/achivements';

const ACHIEVEMENT_RULES: AchievementRule[] = [
  {
    id: 'first-result',
    title: 'First result',
    image: `${ACHIEVEMENT_IMAGE_DIR}/first_win.png`,
    target: 1,
    progress: (stats) => stats.matchesPlayed,
    detail: () => 'First match completed',
  },
  {
    id: 'match-experience',
    title: 'Match experience',
    image: `${ACHIEVEMENT_IMAGE_DIR}/first_win.png`,
    target: 5,
    progress: (stats) => stats.matchesPlayed,
    detail: (stats) => `${stats.matchesPlayed} matches played`,
  },
  {
    id: 'regular-player',
    title: 'Regular player',
    image: `${ACHIEVEMENT_IMAGE_DIR}/first_win.png`,
    target: 15,
    progress: (stats) => stats.matchesPlayed,
    detail: () => '15+ matches on profile',
  },
  {
    id: 'first-card',
    title: 'First card',
    image: `${ACHIEVEMENT_IMAGE_DIR}/first_win.png`,
    target: 1,
    progress: (stats) => stats.cardsClaimed,
    detail: () => 'First match card claimed',
  },
  {
    id: 'card-collector',
    title: 'Collector',
    image: `${ACHIEVEMENT_IMAGE_DIR}/first_win.png`,
    target: 5,
    progress: (stats) => stats.cardsClaimed,
    detail: (stats) => `${stats.cardsClaimed} cards in collection`,
  },
  {
    id: 'accurate-forecast',
    title: 'Accurate prediction',
    image: `${ACHIEVEMENT_IMAGE_DIR}/forecast_master.png`,
    target: 50,
    progress: (stats) => accuracyPercent(stats),
    detail: (stats) => `Accuracy ${accuracyPercent(stats)}%`,
  },
  {
    id: 'forecast-master',
    title: 'Prediction master',
    image: `${ACHIEVEMENT_IMAGE_DIR}/forecast_master.png`,
    target: 65,
    progress: (stats) => accuracyPercent(stats),
    detail: () => 'Accuracy above 65%',
  },
  {
    id: 'elite-accuracy',
    title: 'Elite accuracy',
    image: `${ACHIEVEMENT_IMAGE_DIR}/forecast_master.png`,
    target: 80,
    progress: (stats) => accuracyPercent(stats),
    detail: () => 'Accuracy above 80%',
  },
  {
    id: 'first-raid',
    title: 'First raid',
    image: `${ACHIEVEMENT_IMAGE_DIR}/raid_king.png`,
    target: 200,
    progress: (stats) => stats.totalPoints,
    detail: (stats) => `${stats.totalPoints.toLocaleString('en-US')} total points`,
  },
  {
    id: 'raid-king',
    title: 'Raid king',
    image: `${ACHIEVEMENT_IMAGE_DIR}/raid_king.png`,
    target: 1000,
    progress: (stats) => stats.totalPoints,
    detail: () => '1,000+ raid points',
  },
  {
    id: 'room-legend',
    title: 'Room legend',
    image: `${ACHIEVEMENT_IMAGE_DIR}/raid_king.png`,
    target: 3000,
    progress: (stats) => stats.totalPoints,
    detail: () => '3,000+ raid points',
  },
  {
    id: 'streak-3',
    title: 'Win streak',
    image: `${ACHIEVEMENT_IMAGE_DIR}/series.png`,
    target: 3,
    progress: (stats) => stats.bestStreak,
    detail: (stats) => `Best streak ${stats.bestStreak}`,
  },
  {
    id: 'streak-5',
    title: 'Hot streak',
    image: `${ACHIEVEMENT_IMAGE_DIR}/series.png`,
    target: 5,
    progress: (stats) => stats.bestStreak,
    detail: () => '5 correct answers in the best streak',
  },
  {
    id: 'streak-8',
    title: 'Perfect run',
    image: `${ACHIEVEMENT_IMAGE_DIR}/series.png`,
    target: 8,
    progress: (stats) => stats.bestStreak,
    detail: () => '8+ best streak',
  },
];

export function achievementProgressForStats(stats: PlayerStats): AchievementProgress[] {
  return ACHIEVEMENT_RULES.map((rule) => {
    const progress = Math.max(0, Math.floor(rule.progress(stats)));
    return {
      id: rule.id,
      title: rule.title,
      detail: rule.detail(stats),
      image: rule.image,
      progress,
      target: rule.target,
      qualified: progress >= rule.target,
    };
  });
}

function accuracyPercent(stats: PlayerStats): number {
  if (stats.matchesPlayed <= 0) return 0;
  return Math.round(stats.averageAccuracy * 100);
}
