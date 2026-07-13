import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type PhaserType from 'phaser';
import { flagAssetForTeam, teamInitials, type DailyQuestState, type RoomStatePublic } from '@fan-raid/shared';
import { DailyQuestCard } from '../components/DailyQuestCard.js';

type MiniGameId = 'penalty' | 'event-predictor' | 'keeper-reaction' | 'corner-kick' | 'football-quiz';

interface MiniGame {
  id: MiniGameId;
  title: string;
  shortTitle: string;
  description: string;
  reward: string;
  badge: string;
  icon: string;
}

const MINI_GAMES: MiniGame[] = [
  {
    id: 'penalty',
    title: 'Penalties',
    shortTitle: 'Penalties',
    description: 'Score against the opponent',
    reward: '100-300',
    badge: 'LIVE',
    icon: '⚽',
  },
  {
    id: 'keeper-reaction',
    title: 'Keeper reaction',
    shortTitle: 'Keeper reaction',
    description: 'Save incoming shots',
    reward: '120-280',
    badge: 'TOP',
    icon: '🧤',
  },
  {
    id: 'corner-kick',
    title: 'Corner kick',
    shortTitle: 'Corner kick',
    description: 'Hit the target from a corner',
    reward: '100-250',
    badge: 'NEW',
    icon: '🚩',
  },
  {
    id: 'football-quiz',
    title: 'Football quiz',
    shortTitle: 'Quiz',
    description: 'Answer football questions',
    reward: '80-200',
    badge: 'TOP',
    icon: '🏆',
  },
];

const EVENT_PREDICTOR_GAME: MiniGame = {
  id: 'event-predictor',
  title: 'Guess the event',
  shortTitle: 'Guess event',
  description: 'Predict the next event',
  reward: '100-250',
  badge: 'FAST',
  icon: '❔',
};

const MINI_GAME_BACKGROUNDS: Record<MiniGameId, string> = {
  penalty: '/images/mini-games/penalty.jpg',
  'event-predictor': '/images/mini-games/event-predictor.jpg',
  'keeper-reaction': '/images/mini-games/keeper-reaction.jpg',
  'corner-kick': '/images/mini-games/corner-kick.jpg',
  'football-quiz': '/images/mini-games/football-quiz.jpg',
};

const QUICK_START_BACKGROUNDS: Record<MiniGameId, string> = {
  penalty: '/images/mini-games/quick-penalty.jpg',
  'event-predictor': '/images/mini-games/quick-event-predictor.jpg',
  'keeper-reaction': '/images/mini-games/quick-keeper-reaction.jpg',
  'corner-kick': '/images/mini-games/quick-corner-kick.jpg',
  'football-quiz': '/images/mini-games/quick-football-quiz.jpg',
};

const QUICK_START: MiniGame[] = [
  MINI_GAMES[0]!,
  EVENT_PREDICTOR_GAME,
  MINI_GAMES[3]!,
];

interface CountdownParts {
  hours: string;
  minutes: string;
  seconds: string;
  expired: boolean;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function countdownParts(targetMs: number | null): CountdownParts {
  const target = targetMs && Number.isFinite(targetMs) ? targetMs : Date.now();
  const left = Math.max(0, target - Date.now());
  const totalSeconds = Math.floor(left / 1000);

  return {
    hours: pad(Math.floor(totalSeconds / 3600)),
    minutes: pad(Math.floor((totalSeconds % 3600) / 60)),
    seconds: pad(totalSeconds % 60),
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

function scoreLabel(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function formatMatchDate(value?: string): string {
  if (!value) return 'Time TBD';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time TBD';
  const dayMonth = date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${dayMonth}, ${time}`;
}

export function MiniGames({
  room,
  daily,
  dailyBusy,
  isAuthenticated,
  onClaimDaily,
  onJoinLive,
}: {
  room: RoomStatePublic;
  daily?: DailyQuestState;
  dailyBusy: boolean;
  isAuthenticated: boolean;
  onClaimDaily: () => void;
  onJoinLive: () => void;
}): JSX.Element {
  const [activeGame, setActiveGame] = useState<MiniGameId | null>(null);
  const selectedGame = [...MINI_GAMES, EVENT_PREDICTOR_GAME].find((game) => game.id === activeGame) ?? null;
  const homeTeam = room.match.teams.home;
  const awayTeam = room.match.teams.away;
  const homeFlag = flagAssetForTeam(homeTeam);
  const awayFlag = flagAssetForTeam(awayTeam);
  const parsedStartsAtMs = room.match.startsAt ? Date.parse(room.match.startsAt) : Number.NaN;
  const startsAtMs = Number.isFinite(parsedStartsAtMs) ? parsedStartsAtMs : null;
  const showCountdown = room.match.status !== 'live' && startsAtMs !== null && startsAtMs > Date.now();
  const matchCountdown = useCountdown(showCountdown ? startsAtMs : null);
  const isLiveMatch = room.match.status === 'live' || room.phase === 'first_half' || room.phase === 'second_half' || room.phase === 'halftime';
  const statusLabel = isLiveMatch ? 'Match live' : (matchCountdown.expired ? 'Starting soon' : 'Match starts in');

  if (selectedGame) {
    return (
      <div className="app-shell mini-games-page mini-game-detail-page">
        <header className="mini-games-heading mini-game-detail-top">
          <button className="button-compact mini-back-button" onClick={() => setActiveGame(null)}>
            Back
          </button>
          <div>
            <h1>{selectedGame.title}</h1>
            <p>{selectedGame.description} · reward {selectedGame.reward}</p>
          </div>
        </header>

        <section className="panel phaser-game-panel">
          <div className="phaser-game-head">
            <div>
              <h2>{selectedGame.shortTitle}</h2>
              <p className="muted">Test Phaser game · 20 sec</p>
            </div>
            <span className="mini-game-status">{selectedGame.badge}</span>
          </div>
          <TargetRushGame key={selectedGame.id} />
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell mini-games-page mini-games-hub">
      <header className="mini-games-heading">
        <div>
          <h1><span className="section-accent" aria-hidden="true" />Games</h1>
          <p>Mini-games and challenges during the match</p>
        </div>
      </header>

      <div className="mini-games-layout">
        <main className="mini-games-main">
          <section
            className="mini-feature-card"
            style={{ '--mini-feature-bg': 'url("/images/mini-games/feature.jpg")' } as CSSProperties}
          >
            <div className="mini-feature-copy">
              <span className="mini-game-status live">LIVE CHALLENGE</span>
              <h2>Guess the next event</h2>
            </div>

            <div className="mini-feature-match">
              <div>
                <span className="mini-flag-mini">
                  <FlagVisual value={homeFlag} label={`${homeTeam} flag`} />
                </span>
                <b>{homeTeam}</b>
              </div>
              <strong>
                {scoreLabel(room.score.home)} : {scoreLabel(room.score.away)}
                <small>{statusLabel}</small>
                <span>
                  {isLiveMatch ? (
                    <>{room.minute}<small>′</small></>
                  ) : (
                    `${matchCountdown.hours}:${matchCountdown.minutes}:${matchCountdown.seconds}`
                  )}
                </span>
              </strong>
              <div>
                <span className="mini-flag-mini">
                  <FlagVisual value={awayFlag} label={`${awayTeam} flag`} />
                </span>
                <b>{awayTeam}</b>
              </div>
            </div>
            <div className="mini-feature-meta">
              <span>{room.match.competition ?? 'Friendlies'}</span>
              <span>{formatMatchDate(room.match.startsAt)}</span>
              <span>{room.match.isReal ? 'TxODDS' : 'SIM'}</span>
            </div>

            <p>Choose what happens next</p>
            <div className="mini-feature-options">
              <button type="button" onClick={onJoinLive}><span>⚽</span>Goal</button>
              <button type="button" onClick={onJoinLive}><span>🟨</span>Yellow card</button>
              <button type="button" onClick={onJoinLive}><span>🔁</span>Substitution</button>
            </div>

            <div className="mini-feature-action">
              <button type="button" onClick={onJoinLive}>
                <span>⚡</span>Play now
              </button>
            </div>
          </section>

          <section className="panel mini-popular-panel">
            <h2><span className="section-accent" aria-hidden="true" />Popular mini-games</h2>
            <div className="mini-game-list">
              {MINI_GAMES.map((game) => (
                <MiniGameCard key={game.id} game={game} onPlay={() => setActiveGame(game.id)} />
              ))}
            </div>
          </section>
        </main>

        <aside className="mini-games-rail">
          <section className="leader-card mini-quick-card">
            <h2><span className="section-accent" aria-hidden="true" />Quick start</h2>
            <div className="mini-quick-list">
              {QUICK_START.map((game) => (
                <button key={game.id} type="button" className="mini-quick-row" onClick={() => setActiveGame(game.id)}>
                  <span
                    className={`mini-quick-art ${game.id}`}
                    style={{ '--mini-quick-bg': `url("${QUICK_START_BACKGROUNDS[game.id]}")` } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span>
                    <b>{game.title}</b>
                    <small>{game.description}</small>
                    <em>Reward: <i className="coin-icon coin-icon-sm" aria-hidden="true" /> {game.reward}</em>
                  </span>
                  <strong>Play</strong>
                </button>
              ))}
            </div>
          </section>

          <DailyQuestCard
            className="mini-daily-card"
            daily={daily}
            busy={dailyBusy}
            isAuthenticated={isAuthenticated}
            onClaimDaily={onClaimDaily}
          />

          <section className="leader-card mini-record-card">
            <h2><span className="section-accent" aria-hidden="true" />Your records</h2>
            <div className="mini-record-list">
              <span><i>⚽</i>Penalties <b>24</b></span>
              <span><i>🧤</i>Keeper reaction <b>18</b></span>
              <span><i>?</i>Guess event <b>73%</b></span>
            </div>
            <button type="button" className="live-secondary-button">All records <span>›</span></button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function MiniGameCard({ game, onPlay }: { game: MiniGame; onPlay: () => void }): JSX.Element {
  return (
    <button
      className={`mini-game-card ${game.id}`}
      style={{ '--mini-game-bg': `url("${MINI_GAME_BACKGROUNDS[game.id]}")` } as CSSProperties}
      aria-label={`Start ${game.title}`}
      onClick={onPlay}
    >
      <span className="mini-card-image" aria-hidden="true" />
      <span className={`mini-game-status ${game.badge.toLowerCase()}`}>{game.badge}</span>
      <span className="mini-game-main">
        <b>{game.title}</b>
        <span>{game.description}</span>
        <em>Reward: <i className="coin-icon coin-icon-sm" aria-hidden="true" /> {game.reward}</em>
      </span>
      <span className="mini-card-play">Play <i>›</i></span>
    </button>
  );
}

function TargetRushGame(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<PhaserType.Game | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return;
    let cancelled = false;

    void import('phaser').then((module) => {
      if (!hostRef.current || gameRef.current || cancelled) return;
      const Phaser = module.default;

      class TargetRushScene extends Phaser.Scene {
      private score = 0;
      private timeLeft = 20;
      private ended = false;
      private target: PhaserType.GameObjects.Arc | null = null;
      private scoreText!: PhaserType.GameObjects.Text;
      private timeText!: PhaserType.GameObjects.Text;

      constructor(private readonly onFinish: (score: number) => void) {
        super('TargetRush');
      }

      create(): void {
        const width = this.scale.width;
        const height = this.scale.height;

        this.add.rectangle(width / 2, height / 2, width, height, 0x0b0f16);
        this.add.grid(width / 2, height / 2, width, height, 32, 32, 0x101722, 0.42, 0x243144, 0.35);

        this.scoreText = this.add.text(18, 16, 'SCORE 0', {
          fontFamily: 'Sora, Arial',
          fontSize: '18px',
          fontStyle: '700',
          color: '#f4f7fb',
        });
        this.timeText = this.add.text(width - 18, 16, '20', {
          fontFamily: 'Sora, Arial',
          fontSize: '18px',
          fontStyle: '700',
          color: '#bdd5ff',
        }).setOrigin(1, 0);

        this.add.text(width / 2, height - 30, 'tap targets', {
          fontFamily: 'Manrope, Arial',
          fontSize: '12px',
          color: '#6f7889',
        }).setOrigin(0.5);

        this.spawnTarget();
        this.time.addEvent({
          delay: 1000,
          repeat: 19,
          callback: () => {
            this.timeLeft -= 1;
            this.timeText.setText(String(this.timeLeft).padStart(2, '0'));
            if (this.timeLeft <= 0) this.finish();
          },
        });
      }

      private spawnTarget(): void {
        if (this.ended) return;
        this.target?.destroy();

        const radius = Phaser.Math.Between(18, 31);
        const x = Phaser.Math.Between(radius + 18, this.scale.width - radius - 18);
        const y = Phaser.Math.Between(74, this.scale.height - radius - 58);
        const color = Phaser.Display.Color.GetColor(
          Phaser.Math.Between(118, 150),
          Phaser.Math.Between(185, 220),
          Phaser.Math.Between(82, 118),
        );

        const target = this.add.circle(x, y, radius, color, 1)
          .setStrokeStyle(3, 0xf4f7fb, 0.52)
          .setInteractive({ useHandCursor: true });

        this.add.circle(x, y, Math.max(4, radius / 3), 0x0b0f16, 0.34);
        this.tweens.add({
          targets: target,
          scale: 1.14,
          duration: 360,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        target.on('pointerdown', () => {
          if (this.ended) return;
          this.score += 1;
          this.scoreText.setText(`SCORE ${this.score}`);
          this.cameras.main.flash(70, 130, 201, 90);
          this.spawnTarget();
        });
        this.target = target;
      }

      private finish(): void {
        if (this.ended) return;
        this.ended = true;
        this.target?.disableInteractive();
        this.target?.destroy();
        this.onFinish(this.score);

        const width = this.scale.width;
        const height = this.scale.height;
        this.add.rectangle(width / 2, height / 2, width - 34, 126, 0x151a23, 0.94)
          .setStrokeStyle(1, 0x394559, 1);
        this.add.text(width / 2, height / 2 - 20, `FINAL ${this.score}`, {
          fontFamily: 'Sora, Arial',
          fontSize: '32px',
          fontStyle: '800',
          color: '#f4f7fb',
        }).setOrigin(0.5);
        this.add.text(width / 2, height / 2 + 24, 'reopen game to retry', {
          fontFamily: 'Manrope, Arial',
          fontSize: '13px',
          color: '#a7b0bf',
        }).setOrigin(0.5);
      }
    }

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: 320,
        height: 420,
        backgroundColor: '#0b0f16',
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: new TargetRushScene(setFinalScore),
      });

      gameRef.current = game;
    });

    return () => {
      cancelled = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <>
      <div className="phaser-game-wrap" ref={hostRef} />
      <div className="phaser-game-foot">
        <span className="muted">Last score</span>
        <b>{finalScore ?? '—'}</b>
      </div>
    </>
  );
}
