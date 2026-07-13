import { TEAM_NAMES, type TeamSide } from '@fan-raid/shared';
import { store, useGame } from '../game/store.js';

// Team-picking screen (design doc section 13.1): two large cards.
export function Pick(): JSX.Element {
  const room = useGame().room;
  const teams = room?.match.teams ?? TEAM_NAMES;
  return (
    <div className="app-shell pick-page">
      <div className="center pick-head">
        <div className="brand">Fan Raid</div>
        <p className="muted">Pick a stand. Every correct prediction moves Fan Power.</p>
      </div>
      <div className="pick-cards">
        <TeamButton side="home" kicker="Home" name={teams.home} />
        <div className="vs-badge">VS</div>
        <TeamButton side="away" kicker="Away" name={teams.away} />
      </div>
    </div>
  );
}

function TeamButton({ side, kicker, name }: { side: TeamSide; kicker: string; name: string }): JSX.Element {
  return (
    <button className={`team-card ${side}`} onClick={() => store.pickSide(side)}>
      <div className="team-card-top">
        <div className="kicker">{kicker}</div>
        <div className="team-code">{teamCode(name)}</div>
      </div>
      <div>
        <div className="big">{name}</div>
        <div className="team-note">You can change side before your first answer</div>
      </div>
      <div className="go">Pick side</div>
    </button>
  );
}

function teamCode(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const source = words.length >= 2 ? words.map((w) => w[0]).join('') : name;
  return source.replace(/[^a-zа-я0-9]/giu, '').slice(0, 3).toUpperCase() || 'FC';
}
