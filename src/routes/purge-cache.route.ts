import express, { type Request, type Response } from 'express';
import { clearAllCaches } from '../cache/ttl-cache';

const router = express.Router();

router.post('/cache/purge', (req: Request, res: Response) => {
  clearAllCaches();
  res.json({ purged: true });
});

export = router;
