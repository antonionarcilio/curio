import express, { type Request, type Response } from 'express';
import { createSignedUrl } from '../signed-url';
import { getChannelVideos } from '../telegram-client';

const router = express.Router();

router.get('/channels/:chatId/videos', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const base = `${req.protocol}://${req.get('host')}`;

    const { chat_id, chat_title, data } = await getChannelVideos(req.params.chatId, limit);
    const dataWithUrls = data.map((video) => ({
      ...video,
      url: createSignedUrl(base, chat_id, video.message_id),
    }));

    res.json({ chat_id, chat_title, data: dataWithUrls });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
