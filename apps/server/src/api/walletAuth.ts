import { createPublicKey, randomBytes, verify as verifyCrypto } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface WalletChallenge {
  walletAddress: string;
  message: string;
  expiresAt: number;
}

const challenges = new Map<string, WalletChallenge>();

export function createWalletChallenge(input: string): WalletChallenge {
  const walletAddress = canonicalWalletAddress(input);
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const message = [
    'Fan Raid wallet login',
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');

  const challenge = { walletAddress, message, expiresAt };
  challenges.set(walletAddress, challenge);
  return challenge;
}

export function verifyWalletChallenge(input: string, message: string, signatureBase64: string): string | null {
  const walletAddress = canonicalWalletAddress(input);
  const challenge = challenges.get(walletAddress);
  if (!challenge || challenge.expiresAt < Date.now() || challenge.message !== message) {
    challenges.delete(walletAddress);
    return null;
  }

  const ok = verifyWalletSignature(walletAddress, message, signatureBase64);
  challenges.delete(walletAddress);
  return ok ? walletAddress : null;
}

export function canonicalWalletAddress(input: string): string {
  return new PublicKey(input).toBase58();
}

function verifyWalletSignature(walletAddress: string, message: string, signatureBase64: string): boolean {
  const signature = decodeBase64(signatureBase64);
  if (signature.length !== 64) return false;

  const publicKey = new PublicKey(walletAddress);
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey.toBytes())]),
    format: 'der',
    type: 'spki',
  });

  return verifyCrypto(null, Buffer.from(message, 'utf8'), key, signature);
}

function decodeBase64(value: string): Buffer {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}
