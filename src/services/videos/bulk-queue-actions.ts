import { getJobIdsByStatus, pauseJob, resumeJob } from '@/services/upload-progress-store';
import { notifyQueueChanged } from '@/services/videos/upload-scheduler';

// Age sobre o estado atual da fila — jobs que entrarem em 'queued' depois
// dessa chamada não são afetados, não é um modo "pausar futuros uploads".
function pauseAllQueued(): string[] {
  const jobIds = getJobIdsByStatus('queued');
  jobIds.forEach((jobId) => pauseJob(jobId));
  return jobIds;
}

function resumeAllPaused(): string[] {
  const jobIds = getJobIdsByStatus('paused');
  jobIds.forEach((jobId) => resumeJob(jobId));
  notifyQueueChanged();
  return jobIds;
}

export { pauseAllQueued, resumeAllPaused };
