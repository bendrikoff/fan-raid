import { useEffect, useMemo, useState } from 'react';
import { TEAM_COLORS, type DailyQuestState, type TeamSide } from '@fan-raid/shared';
import { DailyQuestCard } from '../components/DailyQuestCard.js';
import { PlayerAvatar, playerInitials } from '../components/PlayerAvatar.js';
import { LEAGUES, leagueForPoints } from '../components/leagues.js';

interface Entry {
  playerId: string;
  name: string;
  avatarUrl?: string;
  side: TeamSide;
  points: number;
}

type Period = 'today' | 'week' | 'all';

const PERIOD_LABELS: Array<{ id: Period; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'all', label: 'All time' },
];

function rankClass(i: number): string {
  return i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
}

function sideCode(side: TeamSide): string {
  return side === 'home' ? 'HOME' : 'AWAY';
}

function formatPoints(points: number): string {
  return points.toLocaleString('en-US');
}

// Global leaderboard screen: data comes from the API, UI is built for desktop web.
export function Leaderboard({
  currentPlayerId,
  daily,
  dailyBusy,
  isAuthenticated,
  onClaimDaily,
}: {
  currentPlayerId?: string;
  daily?: DailyQuestState;
  dailyBusy: boolean;
  isAuthenticated: boolean;
  onClaimDaily: () => void;
}): JSX.Element {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('week');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/match/leaderboard?period=${period}`)
      .then((r) => r.json() as Promise<{ period: Period; top: Entry[] }>)
      .then((d) => setRows(d.top))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [period]);

  const topRows = useMemo(() => rows.slice(0, 3), [rows]);
  const podiumRows = useMemo(() => [topRows[1], topRows[0], topRows[2]].filter(Boolean) as Entry[], [topRows]);
  const tableRows = useMemo(() => rows.slice(3, 10), [rows]);
  const topScore = Math.max(1, ...rows.map((entry) => entry.points));
  const meIndex = currentPlayerId ? rows.findIndex((entry) => entry.playerId === currentPlayerId) : -1;
  const me = meIndex >= 0 ? rows[meIndex] : undefined;
  const meRank = meIndex >= 0 ? meIndex + 1 : 0;
  const meLeague = leagueForPoints(me?.points ?? 0);
  const nextRankPoints = me && meIndex > 0 ? rows[meIndex - 1]?.points ?? me.points : me?.points ?? 0;
  const pointsToNext = me && meIndex > 0 ? Math.max(0, nextRankPoints - me.points) : 0;
  const meProgress = me ? Math.min(100, Math.round((me.points / topScore) * 100)) : 0;

  return (
    <div className="app-shell leaderboard-page">
      <main className="leaderboard-main">
        <header className="leaderboard-heading">
          <div>
            <span className="section-accent" aria-hidden="true" />
            <h1>Leaderboard</h1>
            <p>Compete with friends and fans</p>
          </div>
          <div className="leaderboard-tabs" role="tablist" aria-label="Leaderboard period">
            {PERIOD_LABELS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={period === item.id}
                className={period === item.id ? 'active' : ''}
                onClick={() => setPeriod(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <section className="panel leaderboard-podium" aria-label="Top players">
          {loading && <p className="muted center leaderboard-loading">Loading...</p>}
          {!loading && podiumRows.length === 0 && (
            <div className="leaderboard-empty">
              <b>No completed matches yet</b>
              <span className="muted">When a match finishes, results will appear here.</span>
            </div>
          )}
          {!loading && podiumRows.map((entry) => {
            const realIndex = rows.indexOf(entry);
            const place = realIndex + 1;
            return (
              <article key={`${entry.name}-${place}`} className={`podium-player podium-${place}`}>
                <div className="podium-crown" aria-hidden="true">{place === 1 ? '♛' : '♜'}</div>
                <PlayerAvatar
                  className="podium-avatar"
                  name={entry.name}
                  avatarUrl={entry.avatarUrl}
                  style={{ borderColor: place === 1 ? '#ffd33d' : place === 2 ? '#dce6f2' : '#de8d52' }}
                />
                <span className="podium-medal">{place}</span>
                <b>{entry.name}</b>
                <small><span className="coin-icon coin-icon-sm" aria-hidden="true" /> {formatPoints(entry.points)}</small>
              </article>
            );
          })}
        </section>

        <section className="panel leaderboard-table">
          <div className="lb-table-head">
            <span>#</span>
            <span>Player</span>
            <span>Team</span>
            <span>Points</span>
          </div>
          <div className="lb-table-body">
            {tableRows.map((entry, offset) => {
              const rank = offset + 4;
              return (
                <div key={entry.playerId} className={`lb-table-row ${rankClass(rank - 1)}${entry.playerId === currentPlayerId ? ' me' : ''}`}>
                  <span className="lb-rank">{rank}</span>
                  <span className="lb-player-cell">
                    <PlayerAvatar className="lb-avatar" name={entry.name} avatarUrl={entry.avatarUrl} style={{ background: TEAM_COLORS[entry.side] }} />
                    <b>{entry.name}{entry.playerId === currentPlayerId ? ' (you)' : ''}</b>
                  </span>
                  <span className="lb-team-cell">
                    <i className="dot" style={{ background: TEAM_COLORS[entry.side], color: TEAM_COLORS[entry.side] }} />
                    {sideCode(entry.side)}
                  </span>
                  <b>{formatPoints(entry.points)}</b>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <aside className="leaderboard-rail">
        <section className="leader-card your-result-card">
          <h2><span className="section-accent" aria-hidden="true" />Your result</h2>
          {me ? (
            <>
              <div className="your-result-row">
                <PlayerAvatar name={me.name} avatarUrl={me.avatarUrl} />
                <div>
                  <b>{me.name}</b>
                  <strong>#{meRank}</strong>
                </div>
                <div className="your-score">
                  <span>Weekly points</span>
                  <b>{formatPoints(me.points)} <span className="coin-icon coin-icon-sm" aria-hidden="true" /></b>
                </div>
              </div>
              <div className="your-progress-copy">
                <span>{meRank === 1 ? 'You are in first place' : `To #${meRank - 1}: ${formatPoints(pointsToNext)} points`}</span>
                <span>{formatPoints(me.points)} / {formatPoints(topScore)}</span>
              </div>
              <div className="leader-progress"><span style={{ width: `${meProgress}%` }} /></div>
            </>
          ) : (
            <p className="muted">Play a match to enter the leaderboard.</p>
          )}
        </section>

        <section className="leader-card friends-card">
          <div className="leader-card-title">
            <h2><span className="section-accent" aria-hidden="true" />Top players</h2>
          </div>
          <div className="friends-list">
            {rows.slice(0, 5).map((entry, index) => (
              <div key={`${entry.playerId}-top`} className="friend-row">
                <PlayerAvatar className="lb-avatar" name={entry.name} avatarUrl={entry.avatarUrl} style={{ background: TEAM_COLORS[entry.side] }} />
                <span className="room-tag">{playerInitials(entry.name)}</span>
                <b>{entry.name}</b>
                <i><span style={{ width: `${Math.max(5, Math.round((entry.points / topScore) * 100))}%` }} /></i>
                <strong>{formatPoints(entry.points)} <span className="coin-icon coin-icon-sm" aria-hidden="true" /></strong>
              </div>
            ))}
            {!loading && rows.length === 0 && <p className="muted">Empty for now.</p>}
          </div>
        </section>

        <section className="leader-card leagues-card">
          <h2><span className="section-accent" aria-hidden="true" />Season leagues</h2>
          <div className="league-grid">
            {(Object.keys(LEAGUES) as Array<keyof typeof LEAGUES>).map((tier) => {
              const league = LEAGUES[tier];
              return (
                <div key={tier} className={`league-badge ${tier}${meLeague === tier ? ' active' : ''}`}>
                  <img src={league.image} alt={league.title} loading="lazy" />
                  <b>{league.title}</b>
                  <small>{league.range}</small>
                  {meLeague === tier && <em>Your league</em>}
                </div>
              );
            })}
          </div>
        </section>

        <DailyQuestCard
          className="rating-daily-card"
          daily={daily}
          busy={dailyBusy}
          isAuthenticated={isAuthenticated}
          onClaimDaily={onClaimDaily}
        />
      </aside>
    </div>
  );
}
