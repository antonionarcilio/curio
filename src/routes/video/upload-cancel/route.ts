import { getJob, requestCancel } from '@/services/upload-progress-store';
import { removeFromQueue } from '@/services/videos/upload-scheduler';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.post('/video/upload/cancel/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ error: `Job não encontrado: ${jobId}` });
    return;
  }
  if (job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') {
    res.status(409).json({ error: `Job já está em estado final: ${job.status}` });
    return;
  }

  const cancelledJob = requestCancel(jobId);
  // Job estava 'queued'/'paused' e nunca chegou a rodar — limpa a entrada
  // pendente do scheduler na hora, em vez de esperar a próxima varredura.
  if (cancelledJob?.status === 'cancelled') removeFromQueue(jobId);
  res.json({ job_id: jobId, status: cancelledJob?.status });
});

export = router;
