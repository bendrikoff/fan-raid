import { useEffect, useMemo, useState } from 'react';
import type { PlayerAchievement, PlayerCard, PlayerProfile } from '@fan-raid/shared';
import { PlayerAvatar } from '../components/PlayerAvatar.js';
import { LEAGUES, leagueForPoints } from '../components/leagues.js';
import { loadPlayerProfile } from '../game/auth.js';

function formatAccuracy(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function CardTile({ card }: { card: PlayerCard }): JSX.Element {
  return (
    <article className={`profile-card rarity-${card.rarity}`}>
      <div className="profile-card-art" aria-hidden="true" />
      <b>{card.title}</b>
      <span>{card.rarity === 'legendary' ? 'Legendary' : card.rarity === 'epic' ? 'Epic' : card.rarity === 'rare' ? 'Rare' : 'Common'}</span>
    </article>
  );
}

const LOCKED_CARD_SLOTS = [
  { title: 'Captain', rarity: 'Rare' },
  { title: 'Legend', rarity: 'Epic' },
  { title: 'I am a fan', rarity: 'Rare' },
  { title: 'Night match', rarity: 'Rare' },
];

function LockedCardTile({ title, rarity }: { title: string; rarity: string }): JSX.Element {
  return (
    <article className="profile-card locked">
      <div className="profile-card-art" aria-hidden="true" />
      <b>{title}</b>
      <span>{rarity}</span>
      <em>Locked</em>
    </article>
  );
}

export function Profile({
  token,
  refreshKey,
  claimBusy,
  onClaimCard,
  onUploadAvatar,
  onNewAchievements,
}: {
  token?: string;
  refreshKey: number;
  claimBusy: boolean;
  onClaimCard: () => Promise<void>;
  onUploadAvatar: (dataUrl: string) => Promise<void>;
  onNewAchievements: (achievements: PlayerAchievement[]) => void;
}): JSX.Element {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarPreview, setAvatarPreview] = useState('');

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setProfile(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void loadPlayerProfile(token)
      .then((data) => {
        if (!cancelled) {
          setProfile(data);
          if (data.newAchievements?.length) onNewAchievements(data.newAchievements);
        }
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onNewAchievements, token, refreshKey]);

  useEffect(() => {
    setAvatarPreview('');
    setAvatarError('');
  }, [token]);

  const cardGroups = useMemo(() => profile?.cards ?? [], [profile?.cards]);
  const stats = profile?.stats;
  const account = profile?.account;
  const level = stats ? Math.max(1, Math.floor(stats.totalPoints / 200) + 1) : 1;
  const nextLevelPoints = level * 200;
  const levelProgress = stats ? Math.min(100, Math.round((stats.totalPoints / nextLevelPoints) * 100)) : 0;
  const leagueTier = leagueForPoints(stats?.totalPoints ?? 0);
  const league = LEAGUES[leagueTier];
  const achievements = profile?.achievements ?? [];

  async function claim(): Promise<void> {
    await onClaimCard();
  }

  async function handleAvatarFile(file: File | undefined): Promise<void> {
    if (!file || avatarBusy) return;
    setAvatarError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setAvatarError('PNG, JPG, and WebP are supported.');
      return;
    }
    if (file.size > 1_500_000) {
      setAvatarError('File must be under 1.5 MB.');
      return;
    }

    setAvatarBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAvatarPreview(dataUrl);
      await onUploadAvatar(dataUrl);
    } catch {
      setAvatarPreview('');
      setAvatarError('Could not upload avatar.');
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className="app-shell profile-page profile-redesign">
      <header className="profile-heading">
        <div>
          <h1><span className="section-accent" aria-hidden="true" />Profile</h1>
          <p>Your achievements, stats, and player cards</p>
        </div>
      </header>

      {loading ? (
        <section className="panel profile-loading">
          <p className="muted center">Loading profile...</p>
        </section>
      ) : !profile || !account || !stats ? (
        <section className="panel profile-loading">
          <h2>Profile unavailable</h2>
          <p className="muted">Sign in again or reconnect your wallet.</p>
        </section>
      ) : (
        <div className="profile-layout">
          <main className="profile-main">
            <section className="profile-hero-card">
              <div className="profile-person">
                <div className="profile-avatar-box">
                  <PlayerAvatar className="profile-photo" name={account.name} avatarUrl={avatarPreview || account.avatarUrl} />
                  <label className="profile-avatar-upload">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={avatarBusy}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        void handleAvatarFile(file);
                      }}
                    />
                    {avatarBusy ? 'Uploading...' : 'Upload avatar'}
                  </label>
                  {avatarError && <small className="profile-avatar-error">{avatarError}</small>}
                </div>
                <div className="profile-person-copy">
                  <div><PlayerAvatar name={account.name} avatarUrl={avatarPreview || account.avatarUrl} /><h2>{account.name}</h2></div>
                  <b>WarDogs 👑</b>
                  <span>{account.walletAddress ? shortWallet(account.walletAddress) : 'Dev account'}</span>
                </div>
                <div className="profile-level">
                  <span>Level</span>
                  <b>{level}</b>
                </div>
                <div className="profile-level-progress">
                  <i><span style={{ width: `${levelProgress}%` }} /></i>
                  <small>{stats.totalPoints} / {nextLevelPoints} to lvl {level + 1}</small>
                </div>
              </div>
              <div className="profile-league-panel">
                <img className="profile-league-mark" src={league.image} alt={league.title} loading="lazy" />
                <span>Current league</span>
                <b>{league.title}</b>
                <small>{league.range}</small>
              </div>
              <div className="profile-hero-stats">
                <div><span>🏆</span><small>Total points</small><b>{stats.totalPoints.toLocaleString('en-US')}</b></div>
                <div><span>🎯</span><small>Accuracy</small><b>{formatAccuracy(stats.averageAccuracy)}</b></div>
                <div><span>⚽</span><small>Matches played</small><b>{stats.matchesPlayed}</b></div>
                <div><span className="coin-icon" aria-hidden="true" /><small>Coins</small><b>{account.coins.toLocaleString('en-US')}</b></div>
              </div>
            </section>

            {profile.claimable && (
              <section className="panel profile-claim">
                <div>
                  <span className="profile-section-label">Match card</span>
                  <h2>Result ready to claim</h2>
                  <p className="muted">
                    {profile.claimable.source === 'test' ? 'Test match' : 'Live match'} · {profile.claimable.points} points · accuracy {formatAccuracy(profile.claimable.accuracy)}
                  </p>
                </div>
                <button className="profile-claim-button" disabled={claimBusy} onClick={() => void claim()}>
                  {claimBusy ? 'Claiming...' : 'Claim card'}
                </button>
              </section>
            )}

            <section className="panel profile-rewards-panel">
              <div className="profile-collection-head">
                <h2><span className="section-accent" aria-hidden="true" />Achievements</h2>
                <span className="profile-count">{achievements.length}</span>
              </div>
              <div className="profile-reward-grid">
                {achievements.length > 0 ? achievements.map((item) => (
                  <article key={item.title} className="profile-reward-card">
                    <span className="profile-reward-icon">
                      <img src={item.image} alt="" loading="lazy" />
                    </span>
                    <b>{item.title}</b>
                    <small>{item.detail}</small>
                    <i className="profile-reward-progress">
                      <span style={{ width: `${Math.min(100, Math.round((item.progress / Math.max(1, item.target)) * 100))}%` }} />
                    </i>
                    <em>{formatAchievementDate(item.earnedAt)}</em>
                  </article>
                )) : (
                  <div className="profile-empty"><b>No achievements yet</b><span className="muted">Play a match to unlock your first achievements.</span></div>
                )}
              </div>
            </section>

            <section className="panel profile-collection">
              <div className="profile-collection-head">
                <h2><span className="section-accent" aria-hidden="true" />Player cards</h2>
                <span className="profile-count">{cardGroups.length}</span>
              </div>
              <div className="profile-card-grid">
                {cardGroups.map((card) => <CardTile key={card.id} card={card} />)}
                {LOCKED_CARD_SLOTS.slice(0, Math.max(1, 6 - cardGroups.length)).map((card) => (
                  <LockedCardTile key={card.title} title={card.title} rarity={card.rarity} />
                ))}
              </div>
            </section>

            <section className="panel profile-season-card">
              <h2><span className="section-accent" aria-hidden="true" />Season stats</h2>
              <div className="profile-season-grid">
                <div><span>Matches</span><b>{stats.matchesPlayed}</b><i><span style={{ width: `${Math.min(100, stats.matchesPlayed * 8)}%` }} /></i></div>
                <div><span>Cards</span><b>{stats.cardsClaimed}</b><i><span style={{ width: `${Math.min(100, stats.cardsClaimed * 14)}%` }} /></i></div>
                <div><span>Best streak</span><b>{stats.bestStreak}</b><i><span style={{ width: `${Math.min(100, stats.bestStreak * 12)}%` }} /></i></div>
                <div><span>Accuracy</span><b>{formatAccuracy(stats.averageAccuracy)}</b><i><span style={{ width: `${Math.round(stats.averageAccuracy * 100)}%` }} /></i></div>
              </div>
            </section>
          </main>
        </div>
      )}
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatAchievementDate(value: number): string {
  if (!Number.isFinite(value)) return 'earned';
  return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(value);
}

function shortWallet(walletAddress: string): string {
  return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
}
