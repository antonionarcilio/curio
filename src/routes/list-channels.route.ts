import express, { type Request, type Response } from 'express';
import { listChannels } from '../telegram-client';

const router = express.Router();

router.get('/channels', async (req: Request, res: Response) => {
  try {
    const channels = await listChannels();
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
