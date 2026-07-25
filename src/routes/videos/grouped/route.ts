import { filterVideos } from '@/services/videos/filters';
import { createSignedUrl } from '@/signed-url';
import { listAllVideos } from '@/telegram-client';
import { isPaginationRequested, paginate, paginationQuerySchema, resolvePagination } from '@/utils/pagination';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';

const router = express.Router();

const videoQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().optional().default(100),
    chat_id: z.string().trim().min(1).optional(),
    chat_title: z.string().trim().min(1).optional(),
    file_name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
  })
  .merge(paginationQuerySchema);

router.get('/videos/grouped', async (req: Request, res: Response) => {
  const parsedQuery = videoQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  try {
    const { limit, chat_id, chat_title, file_name, description, ...paginationQuery } = parsedQuery.data;
    const base = `${req.protocol}://${req.get('host')}`;

    const videos = await listAllVideos({ perChatLimit: limit });
    const filtered = filterVideos(videos, {
      chatId: chat_id,
      chatTitle: chat_title,
      fileName: file_name,
      description,
    });

    const withUrls = (items: typeof filtered) =>
      items.map((video) => ({ ...video, url: createSignedUrl(base, video.chat_id, video.message_id) }));

    if (!isPaginationRequested(paginationQuery)) {
      res.json(withUrls(filtered));
      return;
    }

    const paginated = paginate(filtered, resolvePagination(paginationQuery, limit));
    res.json({ ...paginated, data: withUrls(paginated.data) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
