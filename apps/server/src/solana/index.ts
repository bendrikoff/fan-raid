import type { MatchSummary } from '@fan-raid/shared';
import type { AppConfig } from '../config.js';

// Solana module (section 12, feature flag). The rest of the code does not depend on it.
export interface ChainCommitter {
  commitMatchResult(summary: MatchSummary): Promise<{ signature: string } | null>;
  // cNFT trophy minting is NOT implemented in the MVP (TODO interface).
  mintTrophies?(players: MatchSummary['players']): Promise<void>;
}

// With SOLANA_ENABLED=false, commit nothing (section 12).
export class NoopCommitter implements ChainCommitter {
  async commitMatchResult(_summary: MatchSummary): Promise<{ signature: string } | null> {
    console.log('[solana] chain commit skipped (SOLANA_ENABLED=false)');
    return null;
  }
}

// Factory: returns Noop or Devnet depending on the flag.
export async function createCommitter(config: AppConfig): Promise<ChainCommitter> {
  if (!config.solanaEnabled) return new NoopCommitter();
  // Lazy import so @solana/web3.js is not loaded when the flag is disabled.
  const { DevnetCommitter } = await import('./DevnetCommitter.js');
  return new DevnetCommitter(config);
}
