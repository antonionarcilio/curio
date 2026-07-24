import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { listVideos } from '../telegram-client';
import { buildPageEnvelope, isPaginationRequested, paginationQuerySchema, resolvePagination } from './pagination';

const router = express.Router();

const chatVideosQuerySchema = z
  .object({ limit: z.coerce.number().int().positive().optional().default(100) })
  .merge(paginationQuerySchema);

router.get('/list/:chatId', async (req: Request, res: Response) => {
  const parsedQuery = chatVideosQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  try {
    const { limit, ...paginationQuery } = parsedQuery.data;

    if (!isPaginationRequested(paginationQuery)) {
      const { items } = await listVideos(req.params.chatId, { limit, offset: 0 });
      res.json(items);
      return;
    }

    const resolved = resolvePagination(paginationQuery, limit);
    const { items, total } = await listVideos(req.params.chatId, {
      limit: resolved.per_page,
      offset: (resolved.page - 1) * resolved.per_page,
    });

    res.json(buildPageEnvelope(items, total, resolved));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
