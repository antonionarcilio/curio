import { getMyProfile } from '@/telegram-client';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.get('/me', async (_req: Request, res: Response) => {
  try {
    res.json(await getMyProfile());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
