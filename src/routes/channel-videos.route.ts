import { createSignedUrl } from '@/signed-url';
import type { ChannelVideoItem } from '@/telegram-client';
import { getChannelVideos } from '@/telegram-client';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import {
  buildPageEnvelope,
  isPaginationRequested,
  paginate,
  paginationQuerySchema,
  resolvePagination,
} from './pagination';
import { filterByFileName } from './video-filters';
import { resolveThumbnails, thumbnailQuerySchema } from './video-thumbnails';

const router = express.Router();

const channelVideosQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().optional().default(100),
    file_name: z.string().trim().min(1).optional(),
    thumbnail: thumbnailQuerySchema,
  })
  .merge(paginationQuerySchema);

type ChannelVideosQuery = z.infer<typeof channelVideosQuerySchema>;

router.get('/channels/:channelId/videos', async (req: Request, res: Response) => {
  const parsedQuery = channelVideosQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const body = parsedQuery.data.file_name
      ? await buildFilteredResponse(req.params.channelId, parsedQuery.data, base)
      : await buildNativePageResponse(req.params.channelId, parsedQuery.data, base);

    res.json(body);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Um filtro de texto precisa olhar todo o conjunto (até `limit`) antes de
// paginar — a paginação nativa só busca a janela da página pedida, o que faria a
// busca não encontrar resultados fora dela.
async function buildFilteredResponse(channelId: string, query: ChannelVideosQuery, base: string) {
  const { limit, file_name, thumbnail, ...paginationQuery } = query;
  const { channel_id, channel_title, items } = await getChannelVideos(channelId, { limit, offset: 0 });
  const filtered = filterByFileName(items, file_name);

  if (!isPaginationRequested(paginationQuery)) {
    return { channel_id, channel_title, data: await decorate(filtered, channel_id, thumbnail, base) };
  }

  const page = paginate(filtered, resolvePagination(paginationQuery, limit));
  return { channel_id, channel_title, ...page, data: await decorate(page.data, channel_id, thumbnail, base) };
}

async function buildNativePageResponse(channelId: string, query: ChannelVideosQuery, base: string) {
  const { limit, thumbnail, ...paginationQuery } = query;
  const paginated = isPaginationRequested(paginationQuery);
  const resolved = paginated ? resolvePagination(paginationQuery, limit) : { page: 1, per_page: limit };

  const { channel_id, channel_title, items, total } = await getChannelVideos(channelId, {
    limit: resolved.per_page,
    offset: (resolved.page - 1) * resolved.per_page,
  });
  const data = await decorate(items, channel_id, thumbnail, base);

  if (!paginated) return { channel_id, channel_title, data };
  return { channel_id, channel_title, ...buildPageEnvelope(data, total, resolved) };
}

// Thumbnails e URLs assinadas são resolvidas só pros itens que de fato entram na
// resposta — nunca pra lista inteira quando uma página foi pedida.
async function decorate(items: ChannelVideoItem[], channelId: string, thumbnail: boolean, base: string) {
  const resolved = await resolveThumbnails(items, channelId, thumbnail);
  return resolved.map((video) => ({ ...video, url: createSignedUrl(base, channelId, video.message_id) }));
}

export = router;
