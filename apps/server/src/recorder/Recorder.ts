import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import type { MatchEvent, OddsUpdate, ReplayRecord } from '@fan-raid/shared';
import type { FeedSource } from '../feed/FeedSource.js';

// Recorder (sections 4, 5.4): writes the incoming feed from ANY active source
// to JSONL, turning a live match/simulation into a development replay.
// File: ./recordings/{matchId}.jsonl
export class Recorder {
  private stream: WriteStream | null = null;

  constructor(private readonly dir = './recordings') {}

  attach(feed: FeedSource, matchId: string): void {
    const path = `${this.dir}/${matchId}.jsonl`;
    mkdirSync(dirname(path), { recursive: true });
    this.stream = createWriteStream(path, { flags: 'w' });

    feed.on('odds', (u: OddsUpdate) => this.write({ kind: 'odds', payload: u }));
    feed.on('match', (e: MatchEvent) => this.write({ kind: 'match', payload: e }));
  }

  private write(rec: ReplayRecord): void {
    this.stream?.write(JSON.stringify(rec) + '\n');
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}
