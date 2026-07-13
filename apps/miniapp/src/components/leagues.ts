export type LeagueTier = 'bronze' | 'silver' | 'gold';

export const LEAGUES: Record<LeagueTier, {
  title: string;
  range: string;
  image: string;
}> = {
  bronze: {
    title: 'Bronze',
    range: '0 - 1 999',
    image: '/images/bronze.png',
  },
  silver: {
    title: 'Silver',
    range: '2 000 - 4 999',
    image: '/images/silver.png',
  },
  gold: {
    title: 'Gold',
    range: '5 000+',
    image: '/images/gold.png',
  },
};

export function leagueForPoints(points: number): LeagueTier {
  if (points >= 5000) return 'gold';
  if (points >= 2000) return 'silver';
  return 'bronze';
}
