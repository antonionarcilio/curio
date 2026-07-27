import { getJob, pauseJob } from '@/services/upload-progress-store';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.post('/video/upload/pause/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ error: `Job não encontrado: ${jobId}` });
    return;
  }
  if (job.status !== 'queued') {
    res.status(409).json({ error: `Só é possível pausar um job em fila ('queued'): ${jobId} está '${job.status}'` });
    return;
  }

  const pausedJob = pauseJob(jobId);
  res.json({ job_id: jobId, status: pausedJob?.status });
});

export = router;
