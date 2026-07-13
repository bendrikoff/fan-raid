import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import type { CoinTopupConfig, CoinTopupOption } from '@fan-raid/shared';
import type { AppConfig } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '../..');
const repoRoot = resolve(here, '../../../..');

export const COIN_TOPUP_OPTIONS: CoinTopupOption[] = [
  { id: 'starter', title: 'Starter Pack', coins: 1000, sol: 0.01, lamports: Math.round(0.01 * LAMPORTS_PER_SOL), tag: 'FAST' },
  { id: 'matchday', title: 'Matchday Pack', coins: 3000, sol: 0.025, lamports: Math.round(0.025 * LAMPORTS_PER_SOL), tag: 'VALUE' },
  { id: 'ultras', title: 'Ultras Pack', coins: 7000, sol: 0.05, lamports: Math.round(0.05 * LAMPORTS_PER_SOL), tag: 'MAX' },
];

export function getCoinTopupConfig(config: AppConfig): CoinTopupConfig {
  return {
    network: solanaNetwork(config.solanaRpcUrl),
    rpcUrl: config.solanaRpcUrl,
    treasuryWallet: resolveTreasuryWallet(config),
    options: COIN_TOPUP_OPTIONS,
  };
}

export function coinTopupOption(id: string): CoinTopupOption | null {
  return COIN_TOPUP_OPTIONS.find((option) => option.id === id) ?? null;
}

export async function verifySolTopup(args: {
  rpcUrl: string;
  signature: string;
  payerWallet: string;
  treasuryWallet: string;
  lamports: number;
}): Promise<{ ok: true; slot: number } | { ok: false; reason: string }> {
  const payer = new PublicKey(args.payerWallet).toBase58();
  const treasury = new PublicKey(args.treasuryWallet).toBase58();
  const tx = await waitForParsedTransaction(args.rpcUrl, args.signature);

  if (!tx) return { ok: false, reason: 'transaction not found' };
  if (tx.meta?.err) return { ok: false, reason: 'transaction failed' };
  if (!tx.transaction.signatures.includes(args.signature)) return { ok: false, reason: 'signature mismatch' };

  const paidLamports = transferLamports(tx, payer, treasury);
  if (paidLamports < args.lamports) {
    return { ok: false, reason: `insufficient transfer: ${paidLamports}` };
  }

  return { ok: true, slot: tx.slot };
}

function resolveTreasuryWallet(config: AppConfig): string {
  if (config.solanaTopupTreasuryWallet) return new PublicKey(config.solanaTopupTreasuryWallet).toBase58();

  const keypairPath = resolveExistingPath(config.solanaKeypairPath);
  if (!keypairPath) {
    throw new Error('SOLANA_TOPUP_TREASURY_WALLET is not set and Solana keypair was not found');
  }

  const raw = JSON.parse(readFileSync(keypairPath, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error(`Invalid Solana keypair file: ${keypairPath}`);
  return Keypair.fromSecretKey(Uint8Array.from(raw as number[])).publicKey.toBase58();
}

function resolveExistingPath(path: string): string | null {
  const candidates = isAbsolute(path)
    ? [path]
    : [resolve(process.cwd(), path), resolve(repoRoot, path), resolve(serverRoot, path)];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function solanaNetwork(rpcUrl: string): CoinTopupConfig['network'] {
  if (rpcUrl.includes('mainnet')) return 'mainnet-beta';
  if (rpcUrl.includes('localhost') || rpcUrl.includes('127.0.0.1')) return 'localnet';
  return 'devnet';
}

async function waitForParsedTransaction(rpcUrl: string, signature: string): Promise<ParsedTransactionWithMeta | null> {
  const connection = new Connection(rpcUrl, 'confirmed');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    await new Promise((resolveWait) => setTimeout(resolveWait, 750));
  }
  return null;
}

function transferLamports(tx: ParsedTransactionWithMeta, source: string, destination: string): number {
  let total = 0;
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions),
  ];

  for (const instruction of instructions) {
    const parsed = 'parsed' in instruction ? instruction.parsed : null;
    if (!parsed || typeof parsed !== 'object') continue;
    const typed = parsed as ParsedInstruction['parsed'] & {
      type?: string;
      info?: { source?: string; destination?: string; lamports?: number };
    };
    if (typed.type !== 'transfer') continue;
    if (typed.info?.source !== source || typed.info.destination !== destination) continue;
    total += Number(typed.info.lamports ?? 0);
  }

  return total;
}
