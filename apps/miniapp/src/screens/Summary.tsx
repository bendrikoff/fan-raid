import {
  TEAM_COLORS,
  TEAM_NAMES,
  type LeaderboardEntry,
  type MatchSummary,
  type RoomStatePublic,
  type TeamSide,
} from '@fan-raid/shared';
import { PlayerAvatar } from '../components/PlayerAvatar.js';

function sideLabel(side: TeamSide | 'draw'): string {
  if (side === 'draw') return 'Draw';
  return TEAM_NAMES[side];
}

function rankClass(i: number): string {
  return i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
}

function TopList({ top, meName }: { top: LeaderboardEntry[]; meName?: string }): JSX.Element {
  return (
    <div>
      {top.length === 0 && <p className="muted center">Empty for now</p>}
      {top.map((e, i) => (
        <div key={i} className={`lb-row ${rankClass(i)}${e.name === meName ? ' me' : ''}`}>
          <div className="lb-rank">{i + 1}</div>
          <span className="dot" style={{ background: TEAM_COLORS[e.side], color: TEAM_COLORS[e.side] }} />
          <PlayerAvatar className="lb-avatar" name={e.name} avatarUrl={e.avatarUrl} style={{ background: TEAM_COLORS[e.side] }} />
          <div className="lb-name">{e.name}</div>
          <b>{e.points}</b>
        </div>
      ))}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="stat-row">
      <span className="muted">{label}</span>
      <b>{value}</b>
    </div>
  );
}

// Halftime overlay: current results, then play continues.
export function HalftimeSummary({
  room,
  top,
  onClose,
}: {
  room: RoomStatePublic;
  top: LeaderboardEntry[];
  onClose: () => void;
}): JSX.Element {
  const you = room.you;
  return (
    <div className="overlay">
      <div className="sheet">
        <h2 className="center">Halftime</h2>
        <div className="result-banner">
          <span className="side-home">{room.score.home}</span>
          <span className="muted"> : </span>
          <span className="side-away">{room.score.away}</span>
        </div>
        {you && (
          <div className="panel summary-panel">
            <b>Your summary</b>
            <StatRow label="Points" value={you.points} />
            <StatRow label="Best streak" value={you.bestStreak} />
            <StatRow label="Power impact" value={you.impact} />
          </div>
        )}
        <div>
          <div className="sec-label"><span>Top 10</span><span /></div>
          <TopList top={top} meName={you?.name} />
        </div>
        <button onClick={onClose}>Continue match →</button>
      </div>
    </div>
  );
}

// Final overlay: team result, personal summary, top 10, sharing, on-chain.
export function FinalSummary({
  summary,
  meId,
  claimBusy = false,
  onClaimCard,
}: {
  summary: MatchSummary;
  meId?: string;
  claimBusy?: boolean;
  onClaimCard?: () => Promise<void> | void;
}): JSX.Element {
  const me = summary.players.find((p) => p.id === meId);
  const winner = summary.raidWinner;

  const shareText =
    `Fan Raid: ${TEAM_NAMES.home} ${summary.score.home}-${summary.score.away} ${TEAM_NAMES.away}. ` +
    `Raid won by ${sideLabel(winner)}. ${me ? `My points: ${me.points}.` : ''}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent('https://fan-raid.example')}&text=${encodeURIComponent(shareText)}`;

  return (
    <div className="overlay">
      <div className="sheet">
        <h2 className="center">Match finished</h2>
        <div
          className="result-banner"
          style={{ color: winner === 'draw' ? 'var(--text-2)' : TEAM_COLORS[winner] }}
        >
          {winner === 'draw' ? 'Raid draw' : `Raid for ${sideLabel(winner)}!`}
        </div>
        <div className="center muted">
          Score {summary.score.home} : {summary.score.away} · Fan Power{' '}
          <b className="side-home">{Math.round(summary.finalFanPower)}%</b>
          {' / '}
          <b className="side-away">{100 - Math.round(summary.finalFanPower)}%</b>
        </div>

        {me && (
          <div className="panel summary-panel">
            <b>Personal summary</b>
            <StatRow label="Points" value={me.points} />
            <StatRow label="Best streak" value={me.bestStreak} />
            <StatRow label="Power impact" value={me.impact} />
            <StatRow label="Accuracy" value={`${Math.round(me.accuracy * 100)}%`} />
          </div>
        )}

        <div>
          <div className="sec-label"><span>Top 10 players</span><span /></div>
          <TopList top={summary.top10} meName={me?.name} />
        </div>

        {summary.chainSignature && (
          <a
            href={`https://explorer.solana.com/tx/${summary.chainSignature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="chain-link"
          >
            Result recorded on-chain
          </a>
        )}

        <a href={shareUrl} target="_blank" rel="noreferrer" className="share-link">
          <button className="wide-button">Share result</button>
        </a>
        {me && onClaimCard && (
          <button className="wide-button claim-card-button" disabled={claimBusy} onClick={() => void onClaimCard()}>
            {claimBusy ? 'Claiming card...' : 'Claim match card'}
          </button>
        )}
      </div>
    </div>
  );
}
