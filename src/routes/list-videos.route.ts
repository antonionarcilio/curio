import express, { type Request, type Response } from 'express';
import { createSignedUrl } from '../signed-url';
import { listAllVideos } from '../telegram-client';

const router = express.Router();

router.get('/videos', async (req: Request, res: Response) => {
  try {
    const perChatLimit = Number(req.query.limit) || 10;
    const base = `${req.protocol}://${req.get('host')}`;

    const videos = await listAllVideos({ perChatLimit });
    const withUrls = videos.map((video) => ({
      ...video,
      url: createSignedUrl(base, video.chat_id, video.message_id),
    }));

    res.json(withUrls);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
