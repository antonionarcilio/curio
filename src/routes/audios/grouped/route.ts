import { filterMediaItems } from '@/services/media-filters';
import { createSignedUrl } from '@/signed-url';
import { listAllAudios } from '@/telegram-client';
import { isPaginationRequested, paginate, paginationQuerySchema, resolvePagination } from '@/utils/pagination';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';

const router = express.Router();

const audioQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().optional().default(100),
    chat_id: z.string().trim().min(1).optional(),
    chat_title: z.string().trim().min(1).optional(),
    file_name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
  })
  .merge(paginationQuerySchema);

router.get('/audios/grouped', async (req: Request, res: Response) => {
  const parsedQuery = audioQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  try {
    const { limit, chat_id, chat_title, file_name, description, ...paginationQuery } = parsedQuery.data;
    const base = `${req.protocol}://${req.get('host')}`;

    const audios = await listAllAudios({ perChatLimit: limit });
    const filtered = filterMediaItems(audios, {
      chatId: chat_id,
      chatTitle: chat_title,
      fileName: file_name,
      description,
    });

    const withUrls = (items: typeof filtered) =>
      items.map((audio) => ({ ...audio, url: createSignedUrl(base, 'audio', audio.chat_id, audio.message_id) }));

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
