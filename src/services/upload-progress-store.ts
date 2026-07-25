import config from '@/config';
import type { VideoListItem } from '@/telegram-client';

type UploadJobStatus = 'queued' | 'uploading' | 'completed' | 'error';

type UploadJob = {
  status: UploadJobStatus;
  progress: number;
  chatId: string;
  result?: VideoListItem & { url: string };
  error?: string;
};

const jobs = new Map<string, UploadJob>();

// Jobs concluídos/com erro ficam consultáveis por um tempo depois do estado
// terminal, pra dar tempo do frontend buscar o resultado; jobs nunca
// consultados enquanto 'uploading' não são limpos ativamente.
function scheduleCleanup(jobId: string): void {
  setTimeout(() => jobs.delete(jobId), config.uploadProgressTtlMs).unref();
}

function createJob(jobId: string, chatId: string): void {
  jobs.set(jobId, { status: 'queued', progress: 0, chatId });
}

function startJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'uploading';
}

function setProgress(jobId: string, progress: number): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.progress = progress;
}

function completeJob(jobId: string, result: UploadJob['result']): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'completed';
  job.progress = 1;
  job.result = result;
  scheduleCleanup(jobId);
}

function failJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'error';
  job.error = error;
  scheduleCleanup(jobId);
}

function getJob(jobId: string): UploadJob | undefined {
  return jobs.get(jobId);
}

export { completeJob, createJob, failJob, getJob, setProgress, startJob };
export type { UploadJob, UploadJobStatus };
