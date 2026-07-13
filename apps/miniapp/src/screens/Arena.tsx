import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  TEAM_COLORS,
  type LeaderboardEntry,
  type MatchEventType,
  type PlayerPublic,
  type QuestionPublic,
  type RoomStatePublic,
  type TeamSide,
} from '@fan-raid/shared';
import { store, useGame, type FeedItem, type ResolvedFeedback } from '../game/store.js';
import { PlayerAvatar } from '../components/PlayerAvatar.js';
import { confetti, flash, pulse, shake } from '../fx/effects.js';

const SIDE_CODE: Record<TeamSide, string> = { home: 'HOME', away: 'AWAY' };
const TEAM_FORMATION: Record<TeamSide, string> = { home: '4-3-3', away: '4-2-3-1' };

const EVENT_LABEL: Record<MatchEventType, string> = {
  kickoff: 'Kickoff',
  shot: 'Shot',
  shot_on_target: 'Shot on target',
  corner: 'Corner',
  yellow_card: 'Yellow card',
  red_card: 'Red card',
  goal: 'GOAL!',
  halftime: 'Halftime',
  second_half: 'Second half',
  fulltime: 'Full time',
};

const EVENT_CODE: Record<MatchEventType, string> = {
  kickoff: 'KO',
  shot: 'SH',
  shot_on_target: 'SOT',
  corner: 'COR',
  yellow_card: 'YC',
  red_card: 'RC',
  goal: 'GOAL',
  halftime: 'HT',
  second_half: '2H',
  fulltime: 'FT',
};

export function Arena(): JSX.Element {
  const s = useGame();
  const room = s.room;
  const arenaRef = useRef<HTMLDivElement>(null);
  const fanRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!s.fx) return;
    const e = s.fx.event;
    switch (e.type) {
      case 'goal':
        confetti(e.team ? TEAM_COLORS[e.team] : '#ffd54a');
        flash(e.team ? TEAM_COLORS[e.team] : '#ffffff');
        break;
      case 'red_card':
        shake(arenaRef.current, 600, true);
        flash('#d8302f');
        break;
      case 'yellow_card':
        shake(arenaRef.current, 300);
        break;
      case 'shot':
      case 'shot_on_target':
        shake(arenaRef.current, 400);
        pulse(fanRef.current);
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.fx?.seq]);

  if (!room) {
    return (
      <div className="app-shell center loading-shell">
        <p className="muted">Connecting to match...</p>
      </div>
    );
  }

  const you = room.you;
  const matchRows = useMemo<LeaderboardEntry[]>(() => {
    const fromBroadcast = s.leaderboard?.top ?? [];
    if (fromBroadcast.length > 0) return fromBroadcast;
    return [...room.players]
      .sort((a, b) => b.points - a.points)
      .map((p) => ({ playerId: p.id, name: p.name, avatarUrl: p.avatarUrl, side: p.side, points: p.points }));
  }, [room.players, s.leaderboard]);
  const derivedRank = you ? matchRows.findIndex((row) => row.name === you.name) + 1 : 0;
  const rank = s.leaderboard?.yourRank ?? (derivedRank > 0 ? derivedRank : null);

  return (
    <div className="app-shell arena-page" ref={arenaRef}>
      <MatchCard room={room} />
      <div ref={fanRef}>
        <FanPower value={room.fanPower} room={room} />
      </div>
      <QuestionCard
        question={s.question}
        locked={s.questionLocked}
        answered={s.answeredOptionIndex}
        resolved={s.lastResolved}
        streak={you?.streak ?? 0}
        msPerGameMinute={s.msPerGameMinute}
      />
      {you && <StatsBar you={you} rank={rank} />}
      <MatchLeaderboard rows={matchRows} youName={you?.name} />
      <EventsFeed feed={s.feed} room={room} />
    </div>
  );
}

function MatchCard({ room }: { room: RoomStatePublic }): JSX.Element {
  const live = room.phase === 'first_half' || room.phase === 'second_half';
  return (
    <div className="panel match-card">
      <div className="mc-teams">
        <TeamBadge side="home" room={room} />
        <div className="mc-center">
          <div className={`mc-live${live ? '' : ' off'}`}>
            {live && <span className="live-dot" />}
            {live ? 'LIVE' : phaseLabel(room.phase)} · {room.minute}′
          </div>
          <div className="mc-score">
            <span className="side-home">{room.score.home}</span>
            <span className="mc-colon">:</span>
            <span className="side-away">{room.score.away}</span>
          </div>
          <div className="mc-stadium">Luzhniki · {room.players.length} in raid</div>
        </div>
        <TeamBadge side="away" room={room} />
      </div>
    </div>
  );
}

function TeamBadge({ side, room }: { side: TeamSide; room: RoomStatePublic }): JSX.Element {
  const name = room.match.teams[side];
  return (
    <div className="mc-team">
      <div className="mc-flag" style={{ boxShadow: `0 0 16px ${TEAM_COLORS[side]}66` }}>
        {teamCode(name)}
      </div>
      <div className="mc-name">{name}</div>
      <div className="mc-formation">{TEAM_FORMATION[side]}</div>
    </div>
  );
}

function phaseLabel(phase: RoomStatePublic['phase']): string {
  switch (phase) {
    case 'lobby': return 'Waiting';
    case 'first_half': return '1st half';
    case 'halftime': return 'Halftime';
    case 'second_half': return '2nd half';
    case 'finished': return 'Final';
  }
}

function FanPower({ value, room }: { value: number; room: RoomStatePublic }): JSX.Element {
  const home = Math.round(value);
  const away = 100 - home;
  return (
    <div className="panel fp-card">
      <div className="fp-head">
        <div className="fp-side side-home">
          <b className="num">{home}%</b>
          <span className="muted">{room.match.teams.home}</span>
        </div>
        <div className="fp-title">Fan Power</div>
        <div className="fp-side right side-away">
          <b className="num">{away}%</b>
          <span className="muted">{room.match.teams.away}</span>
        </div>
      </div>
      <div
        className="fp-bar"
        style={{ '--fp-ratio': String(value / 100), '--fp-marker': `${value}%` } as CSSProperties}
      >
        <div className="fp-home" />
        <div className="fp-away" />
        <div className="fp-marker" />
      </div>
    </div>
  );
}

interface OptionStyle { color: string; icon: string; }

function optionStyle(q: QuestionPublic, i: number): OptionStyle {
  if (q.typeId === 'NEXT_DANGER_TEAM') {
    const side: TeamSide = i === 0 ? 'home' : 'away';
    return { color: TEAM_COLORS[side], icon: SIDE_CODE[side] };
  }
  if (q.typeId === 'NEXT_EVENT_TYPE') {
    return [
      { color: '#4f8cff', icon: 'SH' },
      { color: '#39a845', icon: 'COR' },
      { color: '#f6b722', icon: 'CARD' },
    ][i] ?? { color: '#3b82f6', icon: '•' };
  }
  // Yes / No
  return i === 0 ? { color: '#39a845', icon: '✓' } : { color: '#e0453a', icon: '✕' };
}

function QuestionCard({
  question, locked, answered, resolved, streak, msPerGameMinute,
}: {
  question: QuestionPublic | null;
  locked: boolean;
  answered: number | null;
  resolved: ResolvedFeedback | null;
  streak: number;
  msPerGameMinute: number;
}): JSX.Element {
  if (!question && resolved) return <ResolvedCard resolved={resolved} />;
  if (!question) {
    return (
      <div className="panel question center">
        <p className="muted">Waiting for the next question...</p>
      </div>
    );
  }

  const durationMs = Math.max(600, (question.closesAtMinute - question.createdAtMinute) * msPerGameMinute);
  const mult = Math.min(streak + 1, 5);
  const many = question.options.length >= 3;

  return (
    <div className="panel question pop" key={question.id}>
      <div className="q-head">
        <div className="q-title">
          {question.isBonus && <span className="q-bonus-badge">Bonus</span>}
          {question.isBonus ? 'Raid bonus' : 'Live prediction'}
        </div>
        <div className="q-timer-chip">
          <TimerText durationMs={durationMs} frozen={locked || answered !== null} />
        </div>
      </div>
      <div className="q-sub muted">{question.text}</div>
      <div className={`q-grid${many ? ' cols3' : ' cols2'}`}>
        {question.options.map((opt, i) => {
          const st = optionStyle(question, i);
          const picked = answered === i;
          return (
            <button
              key={i}
              className={`opt-card${picked ? ' picked' : ''}`}
              style={{ '--oc': st.color } as CSSProperties}
              disabled={locked || answered !== null}
              onClick={() => store.answer(question.id, i)}
            >
              <span className="opt-icon">{st.icon}</span>
              <span className="opt-label">{opt}</span>
              <span className="opt-mult">×{mult}.0</span>
            </button>
          );
        })}
      </div>
      <div className="q-status center">
        {answered !== null ? (
          <span className="side-home">Answer accepted ✓ · correct gives ×{mult}</span>
        ) : locked ? (
          <span className="muted">Answers closed - waiting for outcome</span>
        ) : (
          <span className="muted">Pick fast!</span>
        )}
      </div>
    </div>
  );
}

function TimerText({ durationMs, frozen }: { durationMs: number; frozen: boolean }): JSX.Element {
  const [leftMs, setLeftMs] = useState(durationMs);

  useEffect(() => {
    if (frozen) {
      setLeftMs(0);
      return;
    }
    const start = performance.now();
    const measure = (): number => {
      const left = Math.max(0, durationMs - (performance.now() - start));
      setLeftMs(left);
      return left;
    };
    measure();
    // Update every 250 ms (not every frame) to avoid overloading the renderer.
    const id = window.setInterval(() => {
      if (measure() <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [durationMs, frozen]);

  return <span>{Math.ceil(leftMs / 1000)} sec</span>;
}

function ResolvedCard({ resolved }: { resolved: ResolvedFeedback }): JSX.Element {
  const { question, correctIndex, pickedIndex, yourResult, pointsDelta, impactDelta } = resolved;
  const verdict: Record<string, string> = {
    correct: `Correct! +${pointsDelta} points · +${impactDelta} power`,
    wrong: 'Missed - streak reset',
    missed: 'Missed',
    void: 'Question voided',
  };
  const vClass = yourResult === 'correct' ? 'side-home' : yourResult === 'wrong' ? 'side-away' : 'muted';
  return (
    <div className="panel question">
      <div className="q-title">{question.isBonus ? 'Raid bonus' : 'Live prediction'}</div>
      <div className="q-sub muted">{question.text}</div>
      <div className={`q-grid${question.options.length >= 3 ? ' cols3' : ' cols2'}`}>
        {question.options.map((opt, i) => {
          const st = optionStyle(question, i);
          let cls = 'opt-card result';
          if (correctIndex === i) cls += ' correct';
          else if (yourResult === 'wrong' && i === pickedIndex) cls += ' wrong';
          else cls += ' dim';
          return (
            <div key={i} className={cls} style={{ '--oc': st.color } as CSSProperties}>
              <span className="opt-icon">{st.icon}</span>
              <span className="opt-label">{opt}</span>
            </div>
          );
        })}
      </div>
      <div className={`q-status center resolved-status ${vClass}`}>{verdict[yourResult]}</div>
    </div>
  );
}

function MatchLeaderboard({
  rows,
  youName,
}: {
  rows: LeaderboardEntry[];
  youName?: string;
}): JSX.Element {
  return (
    <div className="panel match-lb-card">
      <div className="match-lb-head">
        <div>
          <h2>Match leaderboard</h2>
          <p className="muted">Only this test match</p>
        </div>
        <span className="match-lb-count">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="match-lb-empty">
          <b>No players yet</b>
          <span className="muted">Pick a side to enter the match table.</span>
        </div>
      ) : (
        <div className="match-lb-list">
          {rows.slice(0, 6).map((row, index) => (
            <div key={`${row.name}-${index}`} className={`match-lb-row${row.name === youName ? ' me' : ''}`}>
              <span className="match-lb-rank">{index + 1}</span>
              <span className="match-side-dot" style={{ background: TEAM_COLORS[row.side] }} />
              <PlayerAvatar className="match-lb-avatar" name={row.name} avatarUrl={row.avatarUrl} />
              <span className="match-lb-name">{row.name}</span>
              <span className="match-lb-team">{SIDE_CODE[row.side]}</span>
              <b>{row.points}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventsFeed({ feed, room }: { feed: FeedItem[]; room: RoomStatePublic }): JSX.Element {
  return (
    <div className="panel feed-card">
      <div className="feed-head">
        <span className="feed-title"><span className="live-dot" /> LIVE · events</span>
      </div>
      {feed.length === 0 && <div className="muted center feed-empty">Quiet so far...</div>}
      {feed.map((it) => (
        <FeedRow key={it.id} item={it} room={room} />
      ))}
    </div>
  );
}

function FeedRow({ item, room }: { item: FeedItem; room: RoomStatePublic }): JSX.Element {
  const e = item.event;
  return (
    <div className="feed-row">
      <span className={`feed-icon event-${e.type}`}>{EVENT_CODE[e.type]}</span>
      <span className="feed-min">{e.minute}′</span>
      <span className="feed-text">
        {EVENT_LABEL[e.type]}
        {e.team ? <span className="muted"> — {room.match.teams[e.team]}</span> : null}
      </span>
      <span className="feed-score">{item.score.home}:{item.score.away}</span>
    </div>
  );
}

function teamCode(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const source = words.length >= 2 ? words.map((w) => w[0]).join('') : name;
  return source.replace(/[^a-zа-я0-9]/giu, '').slice(0, 3).toUpperCase() || 'FC';
}

function StatsBar({ you, rank }: { you: PlayerPublic; rank: number | null }): JSX.Element {
  return (
    <div className="panel stats-bar">
      <Stat icon="STK" value={String(you.streak)} label={`Streak · best ${you.bestStreak}`} accent="#ff7a2f" />
      <Stat icon="PTS" value={String(you.points)} label="Points" accent="#f6b722" />
      <Stat icon="R#" value={rank ? `#${rank}` : '—'} label="Rank" accent="#5b8cff" />
    </div>
  );
}

function Stat({ icon, value, label, accent }: { icon: string; value: string; label: string; accent: string }): JSX.Element {
  return (
    <div className="stat">
      <div className="stat-ic" style={{ background: `${accent}22`, color: accent }}>{icon}</div>
      <div>
        <div className="stat-v">{value}</div>
        <div className="stat-k muted">{label}</div>
      </div>
    </div>
  );
}
