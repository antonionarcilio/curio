import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { createSignedUrl } from '../signed-url';
import { getChannelVideos } from '../telegram-client';
import { buildPageEnvelope, isPaginationRequested, paginationQuerySchema, resolvePagination } from './pagination';

const router = express.Router();

const channelVideosQuerySchema = z
  .object({ limit: z.coerce.number().int().positive().optional().default(100) })
  .merge(paginationQuerySchema);

router.get('/channels/:chatId/videos', async (req: Request, res: Response) => {
  const parsedQuery = channelVideosQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  try {
    const { limit, ...paginationQuery } = parsedQuery.data;
    const base = `${req.protocol}://${req.get('host')}`;
    const paginated = isPaginationRequested(paginationQuery);
    const resolved = paginated ? resolvePagination(paginationQuery, limit) : { page: 1, per_page: limit };

    const { chat_id, chat_title, items, total } = await getChannelVideos(req.params.chatId, {
      limit: resolved.per_page,
      offset: (resolved.page - 1) * resolved.per_page,
    });

    const itemsWithUrls = items.map((video) => ({ ...video, url: createSignedUrl(base, chat_id, video.message_id) }));

    if (!paginated) {
      res.json({ chat_id, chat_title, data: itemsWithUrls });
      return;
    }

    res.json({ chat_id, chat_title, ...buildPageEnvelope(itemsWithUrls, total, resolved) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
