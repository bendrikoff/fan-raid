import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, sign as signCrypto } from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { config as loadEnv } from 'dotenv';

type NetworkName = 'devnet' | 'mainnet';

interface NetworkConfig {
  rpcUrl: string;
  apiOrigin: string;
  programId: PublicKey;
  txlTokenMint: PublicKey;
}

const NETWORKS: Record<NetworkName, NetworkConfig> = {
  devnet: {
    rpcUrl: 'https://api.devnet.solana.com',
    apiOrigin: 'https://txline-dev.txodds.com',
    programId: new PublicKey('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J'),
    txlTokenMint: new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG'),
  },
  mainnet: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    apiOrigin: 'https://txline.txodds.com',
    programId: new PublicKey('9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA'),
    txlTokenMint: new PublicKey('Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL'),
  },
};

const SUBSCRIBE_DISCRIMINATOR = Buffer.from([254, 28, 191, 138, 156, 179, 183, 53]);
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDir, '../..');
const repoRoot = resolve(scriptDir, '../../../..');

loadEnv({ path: resolve(repoRoot, '.env') });
loadEnv();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (hasFlag(args, 'help')) {
    printHelp();
    return;
  }

  const network = readNetwork(args);
  const networkConfig = NETWORKS[network];
  const serviceLevel = readIntArg(args, 'service-level', network === 'devnet' ? 1 : 1);
  const weeks = readIntArg(args, 'weeks', 4);
  const leagues = readLeagues(readArg(args, 'leagues') ?? '');
  const envPath = resolvePath(readArg(args, 'env') ?? resolve(repoRoot, '.env'), process.cwd());
  const keypairPath = resolvePath(
    readArg(args, 'keypair') ?? process.env.SOLANA_KEYPAIR_PATH ?? resolve(serverRoot, 'solana-keypair.json'),
    serverRoot,
  );
  const fixtureId = readArg(args, 'fixture-id') ?? process.env.TXODDS_MATCH_ID ?? '';

  if (weeks <= 0 || weeks % 4 !== 0) {
    throw new Error('--weeks must be a positive multiple of 4');
  }

  const connection = new Connection(readArg(args, 'rpc-url') ?? process.env.SOLANA_RPC_URL ?? networkConfig.rpcUrl, 'confirmed');
  const payer = loadOrCreateKeypair(keypairPath);

  console.log(`[txline] network=${network}`);
  console.log(`[txline] wallet=${payer.publicKey.toBase58()}`);
  console.log(`[txline] keypair=${keypairPath}`);

  if (network === 'devnet') {
    await ensureDevnetSol(connection, payer, { requestAirdrop: !hasFlag(args, 'skip-airdrop') });
  }

  const txSig =
    readArg(args, 'tx-sig') ??
    (await subscribeFreeTier({
      connection,
      payer,
      networkConfig,
      serviceLevel,
      weeks,
    }));

  const jwt = await startGuestSession(networkConfig.apiOrigin);
  const message = `${txSig}:${leagues.join(',')}:${jwt}`;
  const walletSignature = signActivationMessage(message, payer);
  const apiToken = await activateApiToken({
    apiOrigin: networkConfig.apiOrigin,
    jwt,
    txSig,
    walletSignature,
    leagues,
  });

  upsertEnv(envPath, {
    FEED_SOURCE: 'txodds',
    SOLANA_RPC_URL: networkConfig.rpcUrl,
    SOLANA_KEYPAIR_PATH: relativeServerKeypairPath(keypairPath),
    TXODDS_MODE: 'sse',
    TXODDS_API_URL: `${networkConfig.apiOrigin}/api/odds/stream?fixtureId={matchId}`,
    TXODDS_SCORES_API_URL: `${networkConfig.apiOrigin}/api/scores/stream?fixtureId={matchId}`,
    TXODDS_MATCH_ID: fixtureId,
    TXODDS_BEARER_TOKEN: jwt,
    TXODDS_API_KEY: apiToken,
    TXODDS_API_KEY_HEADER: 'X-Api-Token',
    TXODDS_API_KEY_PREFIX: '',
  });

  console.log('[txline] activation complete');
  console.log(`[txline] subscription tx=${txSig}`);
  console.log(`[txline] guest JWT=${mask(jwt)}`);
  console.log(`[txline] API token=${mask(apiToken)}`);
  console.log(`[txline] wrote ${envPath}`);
  if (!fixtureId) console.log('[txline] TXODDS_MATCH_ID left empty; backend will auto-pick a fixture from TxLINE.');
}

async function subscribeFreeTier(args: {
  connection: Connection;
  payer: Keypair;
  networkConfig: NetworkConfig;
  serviceLevel: number;
  weeks: number;
}): Promise<string> {
  const { connection, payer, networkConfig, serviceLevel, weeks } = args;
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('token_treasury_v2')], networkConfig.programId);
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    networkConfig.txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from('pricing_matrix')], networkConfig.programId);
  const userTokenAccount = getAssociatedTokenAddressSync(
    networkConfig.txlTokenMint,
    payer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const createUserTokenAccountIx = createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey,
    userTokenAccount,
    payer.publicKey,
    networkConfig.txlTokenMint,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const data = Buffer.alloc(SUBSCRIBE_DISCRIMINATOR.length + 3);
  SUBSCRIBE_DISCRIMINATOR.copy(data, 0);
  data.writeUInt16LE(serviceLevel, SUBSCRIBE_DISCRIMINATOR.length);
  data.writeUInt8(weeks, SUBSCRIBE_DISCRIMINATOR.length + 2);

  const ix = new TransactionInstruction({
    programId: networkConfig.programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pricingMatrixPda, isSigner: false, isWritable: false },
      { pubkey: networkConfig.txlTokenMint, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenTreasuryVault, isSigner: false, isWritable: true },
      { pubkey: tokenTreasuryPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  console.log(`[txline] subscribing serviceLevel=${serviceLevel}, weeks=${weeks}`);
  const tx = new Transaction().add(createUserTokenAccountIx, ix);
  const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  console.log(`[txline] subscription confirmed=${signature}`);
  return signature;
}

async function startGuestSession(apiOrigin: string): Promise<string> {
  const response = await fetch(`${apiOrigin}/auth/guest/start`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`guest session failed: HTTP ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { token?: unknown };
  if (typeof data.token !== 'string' || !data.token) {
    throw new Error('guest session response does not contain token');
  }
  return data.token;
}

async function activateApiToken(args: {
  apiOrigin: string;
  jwt: string;
  txSig: string;
  walletSignature: string;
  leagues: number[];
}): Promise<string> {
  const response = await fetch(`${args.apiOrigin}/api/token/activate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      txSig: args.txSig,
      walletSignature: args.walletSignature,
      leagues: args.leagues,
    }),
  });

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(`activation failed: HTTP ${response.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  if (typeof body === 'string') return body.replace(/^"|"$/g, '').trim();
  if (body && typeof body === 'object' && 'token' in body && typeof body.token === 'string') return body.token;
  throw new Error('activation response does not contain API token');
}

function signActivationMessage(message: string, payer: Keypair): string {
  const seed = Buffer.from(payer.secretKey.slice(0, 32));
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  return signCrypto(null, Buffer.from(message, 'utf8'), privateKey).toString('base64');
}

async function ensureDevnetSol(
  connection: Connection,
  payer: Keypair,
  options: { requestAirdrop: boolean },
): Promise<void> {
  const minLamports = 200_000_000;
  const balance = await connection.getBalance(payer.publicKey, 'confirmed');
  if (balance >= minLamports) {
    console.log(`[txline] devnet SOL balance=${(balance / 1_000_000_000).toFixed(4)}`);
    return;
  }

  const wallet = payer.publicKey.toBase58();
  if (!options.requestAirdrop) {
    throw new Error(
      `devnet wallet has ${(balance / 1_000_000_000).toFixed(4)} SOL. Fund ${wallet} at https://faucet.solana.com and rerun: pnpm txline:activate -- --skip-airdrop`,
    );
  }

  console.log('[txline] requesting devnet airdrop...');
  try {
    const sig = await connection.requestAirdrop(payer.publicKey, 1_000_000_000);
    await connection.confirmTransaction(sig, 'confirmed');
  } catch (err) {
    throw new Error(
      `devnet airdrop failed. Fund ${wallet} manually at https://faucet.solana.com and rerun with --skip-airdrop. Cause: ${String(err)}`,
    );
  }

  const updatedBalance = await connection.getBalance(payer.publicKey, 'confirmed');
  if (updatedBalance < minLamports) {
    throw new Error(
      `devnet wallet still has only ${(updatedBalance / 1_000_000_000).toFixed(4)} SOL. Fund ${wallet} at https://faucet.solana.com and rerun: pnpm txline:activate -- --skip-airdrop`,
    );
  }
  console.log(`[txline] devnet SOL balance=${(updatedBalance / 1_000_000_000).toFixed(4)}`);
}

function loadOrCreateKeypair(path: string): Keypair {
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(raw)) throw new Error(`Invalid Solana keypair file: ${path}`);
    return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
  }

  mkdirSync(dirname(path), { recursive: true });
  const keypair = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)), { encoding: 'utf8', flag: 'wx' });
  console.log(`[txline] created new dev keypair: ${path}`);
  return keypair;
}

function upsertEnv(path: string, values: Record<string, string>): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;
    const key = match[1];
    if (!key) return line;
    const value = values[key];
    if (value === undefined) return line;
    seen.add(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${next.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

function readNetwork(args: string[]): NetworkName {
  const value = (readArg(args, 'network') ?? 'devnet').toLowerCase();
  if (value === 'devnet' || value === 'mainnet') return value;
  throw new Error('--network must be devnet or mainnet');
}

function readLeagues(value: string): number[] {
  if (!value.trim()) return [];
  return value
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v));
}

function readIntArg(args: string[], name: string, fallback: number): number {
  const value = readArg(args, name);
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer`);
  return n;
}

function readArg(args: string[], name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === exact) return args[i + 1];
    if (arg?.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function resolvePath(path: string, base: string): string {
  return resolve(base, path);
}

function relativeServerKeypairPath(keypairPath: string): string {
  const normalizedServerKeypair = resolve(serverRoot, 'solana-keypair.json');
  if (resolve(keypairPath) === normalizedServerKeypair) return './solana-keypair.json';
  return keypairPath;
}

function mask(value: string): string {
  if (value.length <= 16) return '<hidden>';
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function printHelp(): void {
  console.log(`Usage:
  npm run txline:activate -- --fixture-id <fixtureId>

Options:
  --network devnet|mainnet      Default: devnet
  --keypair <path>              Default: apps/server/solana-keypair.json
  --env <path>                  Default: repo .env
  --service-level <id>          Default: 1
  --weeks <n>                   Default: 4, must be multiple of 4
  --leagues <a,b,c>             Default: empty standard bundle
  --fixture-id <id>             Optional, writes TXODDS_MATCH_ID
  --tx-sig <signature>          Skip subscription tx and activate existing tx
  --skip-airdrop                Do not request devnet SOL; wallet must already be funded
`);
}

main().catch((err) => {
  console.error('[txline] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
