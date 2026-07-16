import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type {
  AccountProfile,
  ClaimCardResponse,
  CoinTopupConfig,
  LiveDashboard,
  PlayerProfile,
  PredictionOptionId,
} from '@fan-raid/shared';

const TOKEN_KEY = 'fanraid.token';
const NAME_KEY = 'fanraid.name';
const PLAYER_ID_KEY = 'fanraid.playerId';
const AVATAR_KEY = 'fanraid.avatar';
const WALLET_KEY = 'fanraid.wallet';
const COINS_KEY = 'fanraid.coins';
const AUTH_METHOD_KEY = 'fanraid.authMethod';

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
}

interface WalletPublicKey {
  toBase58?: () => string;
  toString: () => string;
}

interface SolanaWalletProvider {
  isPhantom?: boolean;
  publicKey?: WalletPublicKey | null;
  connect: () => Promise<{ publicKey?: WalletPublicKey }>;
  signMessage?: (
    message: Uint8Array,
    encoding?: string,
  ) => Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
}

type AuthMethod = AccountProfile['authMethod'];

export interface Session extends AccountProfile {
  token: string;
}

function tg(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

function walletProvider(): SolanaWalletProvider | null {
  const w = window as unknown as {
    solana?: SolanaWalletProvider;
    phantom?: { solana?: SolanaWalletProvider };
  };
  return w.phantom?.solana ?? w.solana ?? null;
}

function requiresHttpsForWallet(): boolean {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return window.location.protocol !== 'https:' && !isLocal;
}

export function hasWalletProvider(): boolean {
  return Boolean(walletProvider()?.connect);
}

export function savedSession(): Session | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const name = localStorage.getItem(NAME_KEY);
  const playerId = localStorage.getItem(PLAYER_ID_KEY);
  if (!token || !name || !playerId) return null;

  const walletAddress = localStorage.getItem(WALLET_KEY) || undefined;
  const avatarUrl = localStorage.getItem(AVATAR_KEY) || undefined;
  const coinsRaw = localStorage.getItem(COINS_KEY);
  const coins = coinsRaw && Number.isFinite(Number(coinsRaw)) ? Math.max(0, Math.floor(Number(coinsRaw))) : 5000;
  const method = (localStorage.getItem(AUTH_METHOD_KEY) as AuthMethod | null) ?? (walletAddress ? 'wallet' : 'dev');
  return { token, name, playerId, avatarUrl, walletAddress, coins, authMethod: method };
}

function store(session: Session): Session {
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(NAME_KEY, session.name);
  localStorage.setItem(PLAYER_ID_KEY, session.playerId);
  localStorage.setItem(COINS_KEY, String(session.coins));
  localStorage.setItem(AUTH_METHOD_KEY, session.authMethod);
  if (session.avatarUrl) localStorage.setItem(AVATAR_KEY, session.avatarUrl);
  else localStorage.removeItem(AVATAR_KEY);
  if (session.walletAddress) localStorage.setItem(WALLET_KEY, session.walletAddress);
  else localStorage.removeItem(WALLET_KEY);
  return session;
}

export function updateStoredSessionCoins(coins: number): void {
  localStorage.setItem(COINS_KEY, String(Math.max(0, Math.floor(coins))));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(PLAYER_ID_KEY);
  localStorage.removeItem(AVATAR_KEY);
  localStorage.removeItem(WALLET_KEY);
  localStorage.removeItem(COINS_KEY);
  localStorage.removeItem(AUTH_METHOD_KEY);
}

export function isTelegram(): boolean {
  const w = tg();
  return Boolean(w?.initData && w.initData.length > 0);
}

export async function loadAccount(token: string): Promise<Session> {
  const account = await authorizedJson<AccountProfile>('/api/account/me', token);
  const current = savedSession();
  return store({ ...account, token: current?.token ?? token });
}

export async function loadPlayerProfile(token: string): Promise<PlayerProfile> {
  return authorizedJson<PlayerProfile>('/api/account/profile', token);
}

export async function loadLiveDashboard(token?: string): Promise<LiveDashboard> {
  return token
    ? authorizedJson<LiveDashboard>('/api/live/dashboard', token)
    : fetchJson<LiveDashboard>('/api/live/dashboard');
}

export async function authTelegram(): Promise<Session> {
  const w = tg();
  w?.ready?.();
  w?.expand?.();
  const data = await postJson<Session>('/api/auth/telegram', { initData: w?.initData ?? '' });
  return store(data);
}

export async function authDev(name: string): Promise<Session> {
  const data = await postJson<Session>('/api/auth/dev', { name });
  return store(data);
}

export async function authWallet(): Promise<Session> {
  const provider = walletProvider();
  if (!provider && requiresHttpsForWallet()) throw new Error('wallet_requires_https');
  if (!provider) throw new Error('wallet_not_found');
  if (!provider.signMessage) throw new Error('wallet_sign_not_supported');

  const connected = await provider.connect();
  const publicKey = connected.publicKey ?? provider.publicKey;
  const walletAddress = publicKey?.toBase58?.() ?? publicKey?.toString();
  if (!walletAddress) throw new Error('wallet_public_key_missing');

  const challenge = await postJson<{ walletAddress: string; message: string; expiresAt: number }>(
    '/api/auth/wallet/challenge',
    { walletAddress },
  );
  const messageBytes = new TextEncoder().encode(challenge.message);
  const signed = await provider.signMessage(messageBytes, 'utf8');
  const signatureBytes = signed instanceof Uint8Array ? signed : signed.signature;
  const signature = bytesToBase64(signatureBytes);

  const data = await postJson<Session>('/api/auth/wallet/verify', {
    walletAddress: challenge.walletAddress,
    message: challenge.message,
    signature,
  });
  return store(data);
}

export async function spendAccountCoins(token: string, amount: number): Promise<AccountProfile> {
  return authorizedJson<AccountProfile>('/api/account/coins/spend', token, { amount });
}

export async function grantAccountCoins(token: string, amount: number): Promise<AccountProfile> {
  return authorizedJson<AccountProfile>('/api/account/coins/grant', token, { amount });
}

export async function uploadAccountAvatar(token: string, dataUrl: string): Promise<Session> {
  return store(await authorizedJson<Session>('/api/account/avatar', token, { dataUrl }));
}

export async function claimMatchCard(token: string): Promise<ClaimCardResponse> {
  return authorizedJson<ClaimCardResponse>('/api/account/cards/claim', token, {});
}

export async function submitLivePrediction(
  token: string,
  optionId: PredictionOptionId,
): Promise<{ created: boolean; account: AccountProfile; dashboard: LiveDashboard }> {
  return authorizedJson<{ created: boolean; account: AccountProfile; dashboard: LiveDashboard }>(
    '/api/live/prediction',
    token,
    { optionId },
  );
}

export async function claimDailyQuest(
  token: string,
): Promise<{ claimed: boolean; account: AccountProfile; dashboard: LiveDashboard }> {
  return authorizedJson<{ claimed: boolean; account: AccountProfile; dashboard: LiveDashboard }>(
    '/api/live/daily/claim',
    token,
    {},
  );
}

export async function loadCoinTopupConfig(token: string): Promise<CoinTopupConfig> {
  return authorizedJson<CoinTopupConfig>('/api/account/coins/topup/options', token);
}

export async function payAndVerifyCoinTopup(
  token: string,
  packageId: string,
): Promise<AccountProfile & { creditedCoins: number; signature: string; slot: number }> {
  const config = await loadCoinTopupConfig(token);
  const option = config.options.find((item) => item.id === packageId);
  if (!option) throw new Error('topup_package_not_found');

  const transfer = await sendSolTransfer({
    rpcUrl: config.rpcUrl,
    treasuryWallet: config.treasuryWallet,
    lamports: option.lamports,
  });

  return authorizedJson<AccountProfile & { creditedCoins: number; signature: string; slot: number }>(
    '/api/account/coins/topup/verify',
    token,
    { packageId, signature: transfer.signature, payerWallet: transfer.walletAddress },
  );
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} failed`);
  return res.json() as Promise<T>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed`);
  return res.json() as Promise<T>;
}

async function authorizedJson<T>(url: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${url} failed`);
  return res.json() as Promise<T>;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sendSolTransfer(args: {
  rpcUrl: string;
  treasuryWallet: string;
  lamports: number;
}): Promise<{ signature: string; walletAddress: string }> {
  const provider = walletProvider();
  if (!provider && requiresHttpsForWallet()) throw new Error('wallet_requires_https');
  if (!provider) throw new Error('wallet_not_found');

  const connected = await provider.connect();
  const publicKeyRaw = connected.publicKey ?? provider.publicKey;
  const walletAddress = publicKeyRaw?.toBase58?.() ?? publicKeyRaw?.toString();
  if (!walletAddress) throw new Error('wallet_public_key_missing');

  const connection = new Connection(args.rpcUrl, 'confirmed');
  const fromPubkey = new PublicKey(walletAddress);
  const toPubkey = new PublicKey(args.treasuryWallet);
  const balance = await connection.getBalance(fromPubkey, 'confirmed');
  const feeBufferLamports = 100_000;
  if (balance < args.lamports + feeBufferLamports) {
    throw new Error('wallet_devnet_balance_insufficient');
  }

  const latest = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({
    feePayer: fromPubkey,
    recentBlockhash: latest.blockhash,
  }).add(SystemProgram.transfer({
    fromPubkey,
    toPubkey,
    lamports: args.lamports,
  }));

  if (!provider.signTransaction) {
    throw new Error('wallet_transaction_not_supported');
  }

  const signed = await provider.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    preflightCommitment: 'confirmed',
  });
  await connection.confirmTransaction({ ...latest, signature }, 'confirmed');
  return { signature, walletAddress };
}
