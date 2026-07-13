import {
  MATCH,
  SIM,
  clamp,
  type MatchEvent,
  type MatchEventType,
  type OddsUpdate,
  type Probs,
  type TeamSide,
} from '@fan-raid/shared';
import { Rng } from '../util/rng.js';
import { BaseFeed } from './FeedSource.js';

// SimFeed (section 5.3): generates a plausible 90-minute match + halftime.
// 1 game minute = 60000 / SIM_SPEED ms.
export class SimFeed extends BaseFeed {
  private readonly rng: Rng;
  private readonly msPerMinute: number;
  private matchId = '';
  private minute = 0;
  private timer: NodeJS.Timeout | null = null;
  private strength: { home: number; away: number };
  private probs: Probs;
  private inHalftime = false;
  private halftimeMinutesLeft = 0;

  constructor(simSpeed: number, seed?: number) {
    super();
    this.rng = new Rng(seed);
    this.msPerMinute = 60000 / simSpeed;
    // Team strengths 0.4..0.6 (section 5.3).
    this.strength = {
      home: this.rng.range(SIM.TEAM_STRENGTH_MIN, SIM.TEAM_STRENGTH_MAX),
      away: this.rng.range(SIM.TEAM_STRENGTH_MIN, SIM.TEAM_STRENGTH_MAX),
    };
    this.probs = this.baseProbs();
  }

  private baseProbs(): Probs {
    // Base outcome probabilities from team strengths.
    const h = this.strength.home;
    const a = this.strength.away;
    const total = h + a;
    const drawBias = 0.26;
    let home = ((h / total) * (1 - drawBias));
    let away = ((a / total) * (1 - drawBias));
    let draw = drawBias;
    const s = home + draw + away;
    home /= s;
    draw /= s;
    away /= s;
    return { home, draw, away };
  }

  private normalize(p: Probs): Probs {
    const s = p.home + p.draw + p.away;
    return { home: p.home / s, draw: p.draw / s, away: p.away / s };
  }

  start(matchId: string): void {
    this.matchId = matchId;
    this.minute = 0;
    this.emitMatchEvent('kickoff', undefined, 0);
    this.emitOddsUpdate();
    this.timer = setInterval(() => this.tick(), this.msPerMinute);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    // Halftime: count down pause game minutes; no event feed.
    if (this.inHalftime) {
      this.halftimeMinutesLeft -= 1;
      if (this.halftimeMinutesLeft <= 0) {
        this.inHalftime = false;
        this.emitMatchEvent('second_half', undefined, MATCH.FIRST_HALF_END_MINUTE);
        this.emitOddsUpdate();
      }
      return;
    }

    this.minute += 1;

    // Half boundaries.
    if (this.minute === MATCH.FIRST_HALF_END_MINUTE) {
      this.emitMatchEvent('halftime', undefined, this.minute);
      this.inHalftime = true;
      // HALFTIME_GAME_SECONDS game seconds of halftime → tick pause minutes.
      this.halftimeMinutesLeft = Math.max(1, Math.round(MATCH.HALFTIME_GAME_SECONDS / 60) || 1);
      return;
    }
    if (this.minute >= MATCH.SECOND_HALF_END_MINUTE) {
      this.emitMatchEvent('fulltime', undefined, MATCH.SECOND_HALF_END_MINUTE);
      this.stop();
      return;
    }

    this.rollEvents();
    // OddsUpdate is emitted every game minute.
    this.drift();
    this.emitOddsUpdate();
  }

  // Resolves minute events (section 5.3). Chances are weighted by attacking-team strength.
  private rollEvents(): void {
    for (const team of ['home', 'away'] as TeamSide[]) {
      const w = this.strength[team] / SIM.TEAM_STRENGTH_MAX; // ~0.66..1
      if (this.rng.chance(SIM.P_GOAL * w)) {
        this.onGoal(team);
        continue; // goal is a major event; do not spawn more events for that side this minute
      }
      if (this.rng.chance(SIM.P_RED * w)) this.onCard('red_card', team);
      if (this.rng.chance(SIM.P_YELLOW * w)) this.onCard('yellow_card', team);
      if (this.rng.chance(SIM.P_SHOT_ON_TARGET * w)) this.emitMatchEvent('shot_on_target', team);
      else if (this.rng.chance(SIM.P_SHOT * w)) this.emitMatchEvent('shot', team);
      if (this.rng.chance(SIM.P_CORNER * w)) this.emitMatchEvent('corner', team);
    }
  }

  private onGoal(team: TeamSide): void {
    this.emitMatchEvent('goal', team);
    // A goal recalculates probabilities with a jump (winning side +15..25 pp).
    const shift = this.rng.range(SIM.GOAL_PROB_SHIFT_MIN, SIM.GOAL_PROB_SHIFT_MAX);
    const other: TeamSide = team === 'home' ? 'away' : 'home';
    this.probs[team] = clamp(0.02, 0.96, this.probs[team] + shift);
    this.probs[other] = clamp(0.02, 0.96, this.probs[other] - shift * 0.6);
    this.probs.draw = clamp(0.02, 0.96, this.probs.draw - shift * 0.4);
    this.probs = this.normalize(this.probs);
    // Immediate OddsUpdate after a goal.
    this.emitOddsUpdate();
  }

  private onCard(type: 'yellow_card' | 'red_card', team: TeamSide): void {
    this.emitMatchEvent(type, team);
    // Cards move probabilities by 2..5 pp toward the opponent.
    const shift = this.rng.range(SIM.CARD_PROB_SHIFT_MIN, SIM.CARD_PROB_SHIFT_MAX) *
      (type === 'red_card' ? 2 : 1);
    const other: TeamSide = team === 'home' ? 'away' : 'home';
    this.probs[team] = clamp(0.02, 0.96, this.probs[team] - shift);
    this.probs[other] = clamp(0.02, 0.96, this.probs[other] + shift);
    this.probs = this.normalize(this.probs);
    if (type === 'red_card') this.emitOddsUpdate(); // immediately after a red card
  }

  // Everything else is drift ±0.5 pp/min.
  private drift(): void {
    const d = SIM.DRIFT_PER_MINUTE;
    this.probs.home = clamp(0.02, 0.96, this.probs.home + this.rng.range(-d, d));
    this.probs.away = clamp(0.02, 0.96, this.probs.away + this.rng.range(-d, d));
    this.probs.draw = clamp(0.02, 0.96, this.probs.draw + this.rng.range(-d, d));
    this.probs = this.normalize(this.probs);
  }

  private emitMatchEvent(type: MatchEventType, team?: TeamSide, minute = this.minute): void {
    const e: MatchEvent = { matchId: this.matchId, ts: Date.now(), minute, type };
    if (team) e.team = team;
    this.emitMatch(e);
  }

  private emitOddsUpdate(): void {
    const u: OddsUpdate = {
      matchId: this.matchId,
      ts: Date.now(),
      minute: this.minute,
      probs: { ...this.probs },
    };
    this.emitOdds(u);
  }
}
