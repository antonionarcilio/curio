import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { createSignedUrl } from '../signed-url';
import { getChannelVideos } from '../telegram-client';
import {
  buildPageEnvelope,
  isPaginationRequested,
  paginate,
  paginationQuerySchema,
  resolvePagination,
} from './pagination';
import { filterByFileName } from './video-filters';

const router = express.Router();

const channelVideosQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().optional().default(100),
    file_name: z.string().trim().min(1).optional(),
  })
  .merge(paginationQuerySchema);

router.get('/channels/:channelId/videos', async (req: Request, res: Response) => {
  const parsedQuery = channelVideosQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  try {
    const { limit, file_name, ...paginationQuery } = parsedQuery.data;
    const base = `${req.protocol}://${req.get('host')}`;
    const paginated = isPaginationRequested(paginationQuery);

    // Um filtro de texto precisa olhar todo o conjunto (até `limit`) antes de
    // paginar — a paginação nativa só busca a janela da página pedida, o que
    // faria a busca não encontrar resultados fora dela.
    if (file_name) {
      const { channel_id, channel_title, items } = await getChannelVideos(req.params.channelId, {
        limit,
        offset: 0,
      });
      const filtered = filterByFileName(items, file_name);
      const withUrls = (list: typeof filtered) =>
        list.map((video) => ({ ...video, url: createSignedUrl(base, channel_id, video.message_id) }));

      if (!paginated) {
        res.json({ channel_id, channel_title, data: withUrls(filtered) });
        return;
      }

      const page = paginate(filtered, resolvePagination(paginationQuery, limit));
      res.json({ channel_id, channel_title, ...page, data: withUrls(page.data) });
      return;
    }

    const resolved = paginated ? resolvePagination(paginationQuery, limit) : { page: 1, per_page: limit };

    const { channel_id, channel_title, items, total } = await getChannelVideos(req.params.channelId, {
      limit: resolved.per_page,
      offset: (resolved.page - 1) * resolved.per_page,
    });

    const itemsWithUrls = items.map((video) => ({
      ...video,
      url: createSignedUrl(base, channel_id, video.message_id),
    }));

    if (!paginated) {
      res.json({ channel_id, channel_title, data: itemsWithUrls });
      return;
    }

    res.json({ channel_id, channel_title, ...buildPageEnvelope(itemsWithUrls, total, resolved) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
