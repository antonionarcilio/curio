import { getJob } from '@/services/upload-progress-store';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.get('/video/upload/progress/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ error: `Job não encontrado: ${jobId}` });
    return;
  }

  res.json({
    job_id: jobId,
    status: job.status,
    progress: job.progress,
    ...(job.result ? { chat_id: job.chatId, ...job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  });
});

export = router;
