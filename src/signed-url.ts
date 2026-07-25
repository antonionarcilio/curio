import crypto from 'crypto';
import config from './config';

const TTL_SECONDS = 60 * 60; // URL assinada expira em 1h

function sign(chatId: string, messageId: string | number, exp: number): string {
  return crypto.createHmac('sha256', config.accessToken).update(`${chatId}:${messageId}:${exp}`).digest('hex');
}

export function createSignedUrl(base: string, chatId: string, messageId: string | number): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const sig = sign(chatId, messageId, exp);
  return `${base}/api/v1/video/stream/${chatId}/${messageId}?exp=${exp}&sig=${sig}`;
}

export function verifySignedUrl(
  chatId: string,
  messageId: string | number,
  exp: string | number,
  sig: string,
): boolean {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = sign(chatId, messageId, expNum);
  const provided = Buffer.from(String(sig));
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(provided, expectedBuf);
}
