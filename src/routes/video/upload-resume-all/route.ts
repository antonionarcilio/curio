import { resumeAllPaused } from '@/services/videos/bulk-queue-actions';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.post('/video/upload/resume', (_req: Request, res: Response) => {
  const resumedJobIds = resumeAllPaused();
  res.json({ resumed_job_ids: resumedJobIds });
});

export = router;
