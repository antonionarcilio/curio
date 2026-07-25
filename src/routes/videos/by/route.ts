import { filterByVideoText } from '@/services/videos/filters';
import { resolveThumbnails, thumbnailQuerySchema } from '@/services/videos/thumbnails';
import { createSignedUrl } from '@/signed-url';
import type { ChannelVideoItem } from '@/telegram-client';
import { listVideos } from '@/telegram-client';
import {
  buildPageEnvelope,
  isPaginationRequested,
  paginate,
  paginationQuerySchema,
  resolvePagination,
} from '@/utils/pagination';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';

const router = express.Router();

const chatVideosQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().optional().default(100),
    file_name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    thumbnail: thumbnailQuerySchema,
  })
  .merge(paginationQuerySchema);

type ChatVideosQuery = z.infer<typeof chatVideosQuerySchema>;

router.get('/videos/by/:chatId', async (req: Request, res: Response) => {
  const parsedQuery = chatVideosQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const body =
      parsedQuery.data.file_name || parsedQuery.data.description
        ? await buildFilteredResponse(req.params.chatId, parsedQuery.data, base)
        : await buildNativePageResponse(req.params.chatId, parsedQuery.data, base);

    res.json(body);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

async function buildFilteredResponse(chatId: string, query: ChatVideosQuery, base: string) {
  const { limit, file_name, description, thumbnail, ...paginationQuery } = query;
  const { items } = await listVideos(chatId, { limit, offset: 0 });
  const filtered = filterByVideoText(items, { fileName: file_name, description });

  if (!isPaginationRequested(paginationQuery)) {
    return { chat_id: chatId, data: await decorate(filtered, chatId, thumbnail, base) };
  }

  const page = paginate(filtered, resolvePagination(paginationQuery, limit));
  return { chat_id: chatId, ...page, data: await decorate(page.data, chatId, thumbnail, base) };
}

async function buildNativePageResponse(chatId: string, query: ChatVideosQuery, base: string) {
  const { limit, thumbnail, ...paginationQuery } = query;
  const paginated = isPaginationRequested(paginationQuery);
  const resolved = paginated ? resolvePagination(paginationQuery, limit) : { page: 1, per_page: limit };

  const { items, total } = await listVideos(chatId, {
    limit: resolved.per_page,
    offset: (resolved.page - 1) * resolved.per_page,
  });
  const data = await decorate(items, chatId, thumbnail, base);

  if (!paginated) return { chat_id: chatId, data };
  return { chat_id: chatId, ...buildPageEnvelope(data, total, resolved) };
}

async function decorate(items: ChannelVideoItem[], chatId: string, thumbnail: boolean, base: string) {
  const resolved = await resolveThumbnails(items, chatId, thumbnail);
  return resolved.map((video) => ({ ...video, url: createSignedUrl(base, chatId, video.message_id) }));
}

export = router;
