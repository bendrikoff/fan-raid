import { createHmac, timingSafeEqual } from 'node:crypto';

// Telegram Mini App initData validation (section 11).
// Algorithm: secret_key = HMAC_SHA256(bot_token, "WebAppData");
// verify hash = HMAC_SHA256(data_check_string, secret_key).
export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function validateInitData(
  initData: string,
  botToken: string,
): TelegramUser | null {
  if (!botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    return JSON.parse(userRaw) as TelegramUser;
  } catch {
    return null;
  }
}

export function telegramDisplayName(u: TelegramUser): string {
  if (u.username) return u.username;
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || `tg${u.id}`;
}
