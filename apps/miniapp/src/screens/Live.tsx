import { useEffect, useMemo, useState } from 'react';
import type {
  LiveDashboard,
  LivePredictionOption,
  LiveRaidRow,
  LiveUpcomingMatch,
  PlayerPublic,
  PredictionOptionId,
  RoomStatePublic,
} from '@fan-raid/shared';
import { flagAssetForTeam as sharedFlagAssetForTeam, teamInitials } from '@fan-raid/shared';
import { DailyQuestCard } from '../components/DailyQuestCard.js';
import { PlayerAvatar } from '../components/PlayerAvatar.js';

interface CountdownParts {
  hours: string;
  minutes: string;
  seconds: string;
  label: string;
  expired: boolean;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function countdownParts(targetMs: number | null): CountdownParts {
  const now = Date.now();
  const fallback = new Date(now + 60 * 60_000);
  const target = targetMs && Number.isFinite(targetMs) ? targetMs : fallback.getTime();
  const left = Math.max(0, target - now);
  const totalSeconds = Math.floor(left / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const date = new Date(target);

  return {
    hours: pad(hours),
    minutes: pad(minutes),
    seconds: pad(seconds),
    label: date.toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    expired: left <= 0,
  };
}

function useCountdown(targetMs: number | null): CountdownParts {
  const [parts, setParts] = useState(() => countdownParts(targetMs));

  useEffect(() => {
    setParts(countdownParts(targetMs));
    const id = window.setInterval(() => setParts(countdownParts(targetMs)), 1000);
    return () => window.clearInterval(id);
  }, [targetMs]);

  return parts;
}

function scoreLabel(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function formatDate(value?: string): string {
  if (!value) return 'Time TBD';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time TBD';
  const dayMonth = date.toLocaleDateString('en-US', { day: '2-digit', month: 'long' }).toUpperCase();
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${dayMonth}, ${time}`;
}

function formatCompetition(value?: string): string {
  return value?.trim() || 'Friendlies';
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

function CalendarIcon(): JSX.Element {
  return (
    <svg className="calendar-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5.3 2.6v2.2M12.7 2.6v2.2M3.2 6.7h11.6M4.5 3.9h9a1.6 1.6 0 0 1 1.6 1.6v8.1a1.6 1.6 0 0 1-1.6 1.6h-9a1.6 1.6 0 0 1-1.6-1.6V5.5a1.6 1.6 0 0 1 1.6-1.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function isImageFlag(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function FlagVisual({ value, label }: { value: string; label: string }): JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [value]);

  if (isImageFlag(value) && !failed) {
    return <img src={value} alt={label} loading="lazy" onError={() => setFailed(true)} />;
  }

  return <span>{isImageFlag(value) ? teamInitials(label) : value}</span>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const source = parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2);
  return (source.toUpperCase() || 'FR').slice(0, 2);
}

function rowsFromPlayers(players: PlayerPublic[], youId?: string): LiveRaidRow[] {
  return players
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
      isMe: player.id === youId,
    }));
}

function TeamBlock({ name, flag }: { name: string; flag: string }): JSX.Element {
  return (
    <div className="live-team-block">
      <div className="live-flag emoji-flag">
        <FlagVisual value={flag} label={`${name} flag`} />
      </div>
      <h2>{name}</h2>
    </div>
  );
}

function OptionCard({
  option,
  selected,
  submitted,
  disabled,
  onSelect,
}: {
  option: LivePredictionOption;
  selected: boolean;
  submitted: boolean;
  disabled: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      className={`live-option-card${selected ? ' selected' : ''}${submitted ? ' submitted' : ''}`}
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="option-flag" aria-hidden="true">
        <FlagVisual value={option.flag} label={option.label} />
      </span>
      <b>{option.label}</b>
      <small>×{option.odds.toFixed(2)}</small>
    </button>
  );
}

function UpcomingCard({ match }: { match: LiveUpcomingMatch }): JSX.Element {
  return (
    <div className="upcoming-card">
      <div className="upcoming-top">
        <span>{formatDate(match.startsAt)}</span>
        <b>{match.status === 'live' ? 'LIVE' : 'SOON'}</b>
      </div>
      <div className="upcoming-teams">
        <div>
          <span className="mini-flag mini-flag-emoji">
            <FlagVisual value={match.homeFlag || flagAssetForTeam(match.home)} label="" />
          </span>
          <b>{match.home}</b>
        </div>
        <em>VS</em>
        <div>
          <span className="mini-flag mini-flag-emoji">
            <FlagVisual value={match.awayFlag || flagAssetForTeam(match.away)} label="" />
          </span>
          <b>{match.away}</b>
        </div>
      </div>
      {match.competition && <p className="upcoming-competition">{match.competition}</p>}
    </div>
  );
}

export function LiveHome({
  room,
  dashboard,
  dashboardLoading,
  selectedPrediction,
  predictionBusy,
  dailyBusy,
  isAuthenticated,
  onSelectPrediction,
  onSubmitPrediction,
  onClaimDaily,
  onJoinLive,
  onTestMatch,
}: {
  room: RoomStatePublic;
  dashboard: LiveDashboard | null;
  dashboardLoading: boolean;
  selectedPrediction: PredictionOptionId | null;
  predictionBusy: boolean;
  dailyBusy: boolean;
  isAuthenticated: boolean;
  onSelectPrediction: (optionId: PredictionOptionId) => void;
  onSubmitPrediction: () => void;
  onClaimDaily: () => void;
  onJoinLive: () => void;
  onTestMatch: () => void;
}): JSX.Element {
  const startsAtMs = room.match.startsAt ? Date.parse(room.match.startsAt) : null;
  const heroCountdown = useCountdown(startsAtMs && startsAtMs > Date.now() ? startsAtMs : null);
  const predictionCountdown = useCountdown(dashboard?.prediction.closesAt ?? null);
  const prediction = dashboard?.prediction;
  const submittedOption = prediction?.selectedOptionId ?? null;
  const effectiveSelected = selectedPrediction ?? submittedOption;
  const isSubmitted = Boolean(submittedOption);
  const homeFlag = prediction?.options.find((option) => option.id === 'home')?.flag ?? flagAssetForTeam(room.match.teams.home);
  const awayFlag = prediction?.options.find((option) => option.id === 'away')?.flag ?? flagAssetForTeam(room.match.teams.away);

  const fallbackRows = useMemo(() => rowsFromPlayers(room.players, room.you?.id), [room.players, room.you?.id]);
  const raidRows = dashboard?.raid.rows.length ? dashboard.raid.rows : fallbackRows;
  const raidTotal = dashboard?.raid.totalPoints ?? raidRows.reduce((sum, row) => sum + row.points, 0);
  const raidTarget = dashboard?.raid.targetPoints ?? 5000;
  const raidProgress = dashboard?.raid.progress ?? Math.min(100, Math.round((raidTotal / raidTarget) * 100));
  const participantCount = dashboard?.raid.participants ?? room.players.length;
  const daily = dashboard?.daily;
  const upcoming = dashboard?.upcoming ?? [];
  const avatarRows = raidRows.slice(0, 4);

  const predictButtonText = isSubmitted
    ? 'Prediction submitted'
    : predictionBusy
      ? 'Sending...'
      : effectiveSelected
        ? 'Submit prediction'
        : 'Choose option';

  return (
    <div className="app-shell live-home">
      <section className="live-board-main">
        <article className="live-match-hero">
          <div className="live-match-bg" aria-hidden="true" />
          <div className="live-match-meta">
            <div className="live-meta-left">
              <span className="live-badge"><span className="live-green-dot" />LIVE</span>
              <span className="live-meta-competition">{formatCompetition(room.match.competition).toUpperCase()}</span>
              <span className="live-meta-date"><CalendarIcon />{formatDate(room.match.startsAt)}</span>
            </div>
            <div className="live-data-source">
              <span>Data: {room.match.isReal ? 'TxODDS' : 'SIM'}</span>
              <b>{room.match.externalId ?? 'local'}</b>
            </div>
          </div>

          <div className="live-score-stage">
            <TeamBlock name={room.match.teams.home} flag={homeFlag} />
            <div className="live-score-num">
              <span>{scoreLabel(room.score.home)}</span>
              <em>:</em>
              <span>{scoreLabel(room.score.away)}</span>
            </div>
            <TeamBlock name={room.match.teams.away} flag={awayFlag} />
          </div>

          <div className="live-countdown-card">
            <span>{room.match.status === 'live' ? 'Match live' : 'Match starts in'}</span>
            {room.match.status === 'live' ? (
              <b>{room.minute}<small>′</small></b>
            ) : (
              <b>{heroCountdown.hours} : {heroCountdown.minutes} : {heroCountdown.seconds}</b>
            )}
            <div>
              <small>hrs</small>
              <small>min</small>
              <small>sec</small>
            </div>
          </div>

          <div className="live-raid-strip">
            <div className="live-avatar-stack" aria-label="Raid participants">
              {avatarRows.map((row) => (
                <PlayerAvatar key={row.id} className="live-avatar-mini" name={row.name} avatarUrl={row.avatarUrl} />
              ))}
              <span>+{Math.max(0, participantCount - avatarRows.length)}</span>
            </div>
            <div className="live-participants"><b>{participantCount}</b> participants already in the raid</div>
          </div>

          <div className="live-raid-actions">
            <button className="live-join-button" onClick={onJoinLive}>
              <span>⚡</span>
              <b>Join the raid</b>
              <small>Play with friends</small>
            </button>
            <button className="live-test-button" onClick={onTestMatch}>
              Test match
            </button>
          </div>
        </article>

        <article className="live-upcoming panel">
          <div className="live-section-head">
            <h2>Upcoming matches</h2>
            <button type="button" aria-label="Refresh upcoming matches">{dashboardLoading ? '...' : '›'}</button>
          </div>
          {upcoming.length > 0 ? (
            <div className="upcoming-grid">
              {upcoming.map((match) => <UpcomingCard key={match.id} match={match} />)}
            </div>
          ) : (
            <div className="live-empty-state">
              {dashboardLoading ? 'Loading matches from TxODDS...' : 'TxODDS has not returned upcoming matches yet.'}
            </div>
          )}
        </article>
      </section>

      <aside className="live-side-rail">
        <article className="live-side-card live-prediction-card">
          <div className="live-side-title">
            <span>First prediction</span>
            <b>{predictionCountdown.expired ? 'Closed' : `${predictionCountdown.hours}:${predictionCountdown.minutes}:${predictionCountdown.seconds}`}</b>
          </div>
          <h2>{prediction?.title ?? 'Who scores first?'}</h2>
          <div className="live-options">
            {(prediction?.options ?? []).map((option) => (
              <OptionCard
                key={option.id}
                option={option}
                selected={effectiveSelected === option.id}
                submitted={submittedOption === option.id}
                disabled={predictionBusy || isSubmitted}
                onSelect={() => onSelectPrediction(option.id)}
              />
            ))}
          </div>
          <p className="live-reward">
            Reward: <span className="coin-icon coin-icon-sm" aria-hidden="true" /><b>{prediction?.rewardCoins ?? 100}</b> coins
          </p>
          <button
            className="live-predict-button"
            disabled={predictionBusy || isSubmitted || !effectiveSelected}
            onClick={onSubmitPrediction}
          >
            {predictButtonText}
          </button>
        </article>

        <article className="live-side-card live-room-card">
          <div className="live-side-title">
            <span>Raid room</span>
            <b>Total points: {raidTotal.toLocaleString('en-US')} / {raidTarget.toLocaleString('en-US')}</b>
          </div>
          <div className="live-room-progress"><span style={{ width: `${raidProgress}%` }} /></div>
          <div className="live-room-list">
            {raidRows.length > 0 ? raidRows.map((row) => (
              <div className={`live-room-row${row.isMe ? ' is-me' : ''}`} key={row.id}>
                <PlayerAvatar className="room-avatar" name={row.name} avatarUrl={row.avatarUrl} />
                <span className={`room-tag ${row.side}`}>{row.side === 'home' ? 'HM' : 'AW'}</span>
                <b>{row.name}</b>
                <i><span style={{ width: `${Math.min(100, (row.points / Math.max(1, raidTarget)) * 100 * 4)}%` }} /></i>
                <strong>{row.points}</strong>
              </div>
            )) : (
              <div className="live-room-empty">The room is empty. Join the match and pick a side.</div>
            )}
          </div>
          <button className="live-secondary-button" onClick={onJoinLive}>View all</button>
        </article>

        <DailyQuestCard
          daily={daily}
          busy={dailyBusy}
          isAuthenticated={isAuthenticated}
          onClaimDaily={onClaimDaily}
        />
      </aside>
    </div>
  );
}
