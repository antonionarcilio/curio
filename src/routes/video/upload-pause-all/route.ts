import { pauseAllQueued } from '@/services/videos/bulk-queue-actions';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.post('/video/upload/pause', (_req: Request, res: Response) => {
  const pausedJobIds = pauseAllQueued();
  res.json({ paused_job_ids: pausedJobIds });
});

export = router;
