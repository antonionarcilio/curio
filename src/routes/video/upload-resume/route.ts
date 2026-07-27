import { getJob, resumeJob } from '@/services/upload-progress-store';
import { notifyQueueChanged } from '@/services/videos/upload-scheduler';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.post('/video/upload/resume/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ error: `Job não encontrado: ${jobId}` });
    return;
  }
  if (job.status !== 'paused') {
    res.status(409).json({ error: `Só é possível retomar um job pausado ('paused'): ${jobId} está '${job.status}'` });
    return;
  }

  const resumedJob = resumeJob(jobId);
  notifyQueueChanged();
  res.json({ job_id: jobId, status: resumedJob?.status });
});

export = router;
