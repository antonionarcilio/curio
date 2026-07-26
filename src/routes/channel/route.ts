import { getChannelInfo } from '@/telegram-client';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';

const router = express.Router();

const channelParamsSchema = z.object({
  channel_id: z.string().trim().min(1),
});

router.get('/channel/:channel_id', async (req: Request, res: Response) => {
  const parsedParams = channelParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }

  try {
    res.json(await getChannelInfo(parsedParams.data.channel_id));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
