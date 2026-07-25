import { clearAllCaches } from '@/cache/ttl-cache';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.post('/cache/purge', (req: Request, res: Response) => {
  clearAllCaches();
  res.json({ purged: true });
});

export = router;
