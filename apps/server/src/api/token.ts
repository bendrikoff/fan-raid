import { createHmac, timingSafeEqual } from 'node:crypto';

// Session token signed with the server secret (section 11).
// Format: base64url(payload).base64url(hmacSHA256(payload, secret)).
export interface SessionPayload {
  playerId: string;
  name: string;
  iat: number;
  avatarUrl?: string;
  walletAddress?: string;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(data: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

export function signToken(payload: SessionPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token: string, secret: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as SessionPayload;
    if (typeof payload.playerId !== 'string' || typeof payload.name !== 'string') return null;
    if (payload.avatarUrl !== undefined && typeof payload.avatarUrl !== 'string') return null;
    if (payload.walletAddress !== undefined && typeof payload.walletAddress !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}
