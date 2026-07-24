import express, { type Request, type Response } from 'express';
import { listVideos } from '../telegram-client';

const router = express.Router();

router.get('/list/:chatId', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const videos = await listVideos(req.params.chatId, limit);
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
