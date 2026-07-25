import config from '@/config';
import type { ChannelVideoItem } from '@/telegram-client';
import { getVideoThumbnail } from '@/telegram-client';
import pLimit from 'p-limit';
import { z } from 'zod';

// z.coerce.boolean() trataria qualquer string não-vazia (inclusive "false")
// como true — por isso a query só aceita as duas strings literais e converte
// explicitamente, igual outras query schemas estritas do projeto.
export const thumbnailQuerySchema = z
  .enum(['true', 'false'])
  .optional()
  .default('false')
  .transform((value) => value === 'true');

// Baixar a thumbnail real custa uma chamada por item — por isso é opt-in
// (?thumbnail=true) e paralelizada com o mesmo teto de concorrência usado por
// listAllVideos (acima dele o Telegram responde FLOOD_WAIT).
export async function resolveThumbnails<T extends ChannelVideoItem>(
  items: T[],
  chatId: string,
  wantThumbnail: boolean,
): Promise<T[]> {
  if (!wantThumbnail) return items;

  const limit = pLimit(config.fetchConcurrency);
  return Promise.all(items.map((item) => limit(() => withRealThumbnail(item, chatId))));
}

async function withRealThumbnail<T extends ChannelVideoItem>(item: T, chatId: string): Promise<T> {
  try {
    const thumbnail = await getVideoThumbnail(chatId, item.message_id);
    return { ...item, ...thumbnail };
  } catch {
    // Uma thumbnail que falha (FLOOD_WAIT, vídeo sem PhotoSize) não deve
    // derrubar a listagem inteira — o item volta como veio (thumbnail: null).
    return item;
  }
}
