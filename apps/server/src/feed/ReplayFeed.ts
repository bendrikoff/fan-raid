import { readFileSync } from 'node:fs';
import type { ReplayRecord } from '@fan-raid/shared';
import { BaseFeed } from './FeedSource.js';

// ReplayFeed (section 5.4): reads a JSONL file sorted by ts and plays it back
// with REPLAY_SPEED acceleration (real time is compressed).
export class ReplayFeed extends BaseFeed {
  private records: ReplayRecord[] = [];
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(private readonly file: string, private readonly speed: number) {
    super();
  }

  start(_matchId: string): void {
    const raw = readFileSync(this.file, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    this.records = lines.map((l) => JSON.parse(l) as ReplayRecord);
    if (this.records.length === 0) return;

    const first = this.records[0]!;
    const startTs = first.payload.ts;
    this.stopped = false;

    for (const rec of this.records) {
      const delayRealMs = (rec.payload.ts - startTs) / this.speed;
      const t = setTimeout(() => {
        if (this.stopped) return;
        if (rec.kind === 'odds') this.emitOdds(rec.payload);
        else this.emitMatch(rec.payload);
      }, Math.max(0, delayRealMs));
      this.timers.push(t);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
