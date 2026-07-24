import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { listChannels } from '../telegram-client';
import { isPaginationRequested, paginate, paginationQuerySchema, resolvePagination } from './pagination';

const router = express.Router();

const channelsQuerySchema = z
  .object({ limit: z.coerce.number().int().positive().optional().default(100) })
  .merge(paginationQuerySchema);

router.get('/channels', async (req: Request, res: Response) => {
  const parsedQuery = channelsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  try {
    const { limit, ...paginationQuery } = parsedQuery.data;
    const channels = await listChannels(limit);

    if (!isPaginationRequested(paginationQuery)) {
      res.json(channels);
      return;
    }

    res.json(paginate(channels, resolvePagination(paginationQuery, limit)));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
