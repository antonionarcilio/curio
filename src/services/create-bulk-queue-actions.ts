import type { UploadJobStatus } from '@/services/create-upload-job-store';

type QueueJobStore = {
  getJobIdsByStatus: (status: UploadJobStatus) => string[];
  pauseJob: (jobId: string) => unknown;
  resumeJob: (jobId: string) => unknown;
};

type QueueScheduler = {
  notifyQueueChanged: () => void;
};

// Age sobre o estado atual da fila — jobs que entrarem em 'queued' depois
// dessa chamada não são afetados, não é um modo "pausar futuros uploads".
// Estruturalmente independente do TResult do job-store/scheduler (só usa
// status/ids, nunca o resultado armazenado), por isso vídeo e áudio
// compartilham esta mesma fábrica sem precisar de um generic aqui.
export function createBulkQueueActions(store: QueueJobStore, scheduler: QueueScheduler) {
  function pauseAllQueued(): string[] {
    const jobIds = store.getJobIdsByStatus('queued');
    jobIds.forEach((jobId) => store.pauseJob(jobId));
    return jobIds;
  }

  function resumeAllPaused(): string[] {
    const jobIds = store.getJobIdsByStatus('paused');
    jobIds.forEach((jobId) => store.resumeJob(jobId));
    scheduler.notifyQueueChanged();
    return jobIds;
  }

  return { pauseAllQueued, resumeAllPaused };
}
