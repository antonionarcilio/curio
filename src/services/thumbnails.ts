import config from '@/config';
import type { ThumbnailInfo } from '@/telegram-client';
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

type ThumbnailFetcher = (chatId: string, messageId: number) => Promise<ThumbnailInfo & { thumbnail: string }>;

// Baixar a thumbnail real custa uma chamada por item — por isso é opt-in
// (?thumbnail=true) e paralelizada com o mesmo teto de concorrência usado por
// listAllVideos/listAllAudios (acima dele o Telegram responde FLOOD_WAIT).
// `getThumbnail` é injetado pelo chamador (getVideoThumbnail ou
// getAudioThumbnail) para que esta função fique independente do tipo de mídia.
export async function resolveThumbnails<T extends ThumbnailInfo & { message_id: number }>(
  items: T[],
  chatId: string,
  wantThumbnail: boolean,
  getThumbnail: ThumbnailFetcher,
): Promise<T[]> {
  if (!wantThumbnail) return items;

  const limit = pLimit(config.fetchConcurrency);
  return Promise.all(items.map((item) => limit(() => withRealThumbnail(item, chatId, getThumbnail))));
}

async function withRealThumbnail<T extends ThumbnailInfo & { message_id: number }>(
  item: T,
  chatId: string,
  getThumbnail: ThumbnailFetcher,
): Promise<T> {
  try {
    const thumbnail = await getThumbnail(chatId, item.message_id);
    return { ...item, ...thumbnail };
  } catch {
    // Uma thumbnail que falha (FLOOD_WAIT, item sem PhotoSize) não deve
    // derrubar a listagem inteira — o item volta como veio (thumbnail: null).
    return item;
  }
}
