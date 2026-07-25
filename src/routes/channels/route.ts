import { extractDigits } from '@/services/videos/filters';
import { listChannels } from '@/telegram-client';
import { isPaginationRequested, paginate, paginationQuerySchema, resolvePagination } from '@/utils/pagination';
import { includesSearchTerm } from '@/utils/text-search';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';

const router = express.Router();

const channelsQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().optional().default(100),
    channel_id: z.string().trim().min(1).optional(),
    channel_title: z.string().trim().min(1).optional(),
  })
  .merge(paginationQuerySchema);

function matchesChannelFilters(
  channel: { channel_id: string; channel_title: string },
  filters: { channel_id?: string; channel_title?: string },
): boolean {
  if (filters.channel_id && extractDigits(channel.channel_id) !== extractDigits(filters.channel_id)) return false;
  if (filters.channel_title && !includesSearchTerm(channel.channel_title, filters.channel_title)) return false;
  return true;
}

router.get('/channels', async (req: Request, res: Response) => {
  const parsedQuery = channelsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  try {
    const { limit, channel_id, channel_title, ...paginationQuery } = parsedQuery.data;
    const channels = await listChannels(limit);
    const filtered = channels.filter((channel) => matchesChannelFilters(channel, { channel_id, channel_title }));

    if (!isPaginationRequested(paginationQuery)) {
      res.json(filtered);
      return;
    }

    res.json(paginate(filtered, resolvePagination(paginationQuery, limit)));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
