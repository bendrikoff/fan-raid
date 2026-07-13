import { readFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import type { MatchSummary } from '@fan-raid/shared';
import type { AppConfig } from '../config.js';
import type { ChainCommitter } from './index.js';

// Memo program (SPL Memo) — stores compact data + log hash in a memo instruction.
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// DevnetCommitter (section 12): when SOLANA_ENABLED=true, serializes MatchSummary
// (score, winning side, top 10, sha256 hash of the answer log) and stores it in a
// devnet transaction memo from the server keypair.
export class DevnetCommitter implements ChainCommitter {
  private connection: Connection;
  private payer: Keypair;

  constructor(private readonly config: AppConfig) {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    this.payer = this.loadKeypair(config.solanaKeypairPath);
  }

  private loadKeypair(path: string): Keypair {
    const raw = readFileSync(path, 'utf8');
    const secret = Uint8Array.from(JSON.parse(raw) as number[]);
    return Keypair.fromSecretKey(secret);
  }

  private serialize(summary: MatchSummary): string {
    // Short, compact record — fits into the memo.
    const payload = {
      m: summary.matchId,
      s: `${summary.score.home}-${summary.score.away}`,
      w: summary.raidWinner,
      top: summary.top10.slice(0, 10).map((t) => `${t.name}:${t.points}`),
      h: summary.answersLogSha256,
    };
    return `FANRAID|${JSON.stringify(payload)}`;
  }

  async commitMatchResult(summary: MatchSummary): Promise<{ signature: string } | null> {
    const memo = this.serialize(summary);
    const ix = new TransactionInstruction({
      keys: [{ pubkey: this.payer.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, 'utf8'),
    });
    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.payer]);
    console.log(`[solana] committed on devnet: ${signature}`);
    return { signature };
  }

  // TODO(mvp+1): mint cNFT trophies for raid winners via Bubblegum/Metaplex.
  async mintTrophies(_players: MatchSummary['players']): Promise<void> {
    // Not implemented in the MVP — extension point.
  }
}
