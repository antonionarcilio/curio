import config from '@/config';
import type { VideoListItem } from '@/telegram-client';

type UploadJobStatus = 'queued' | 'uploading' | 'completed' | 'error' | 'cancelled';

type UploadJob = {
  status: UploadJobStatus;
  progress: number;
  chatId: string;
  result?: VideoListItem & { url: string };
  error?: string;
  cancelRequested?: boolean;
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

// Chamado quando o usuário pede cancelamento. Um job 'queued' nunca chega a
// rodar o upload real, então já é finalizado aqui; um job 'uploading' só
// recebe a flag — o envio ao Telegram não pode ser abortado em voo, então o
// job continua 'uploading' até settleUploadJob decidir o que fazer.
function requestCancel(jobId: string): UploadJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  job.cancelRequested = true;
  if (job.status === 'queued') {
    job.status = 'cancelled';
    scheduleCleanup(jobId);
  }
  return job;
}

function isCancelRequested(jobId: string): boolean {
  return jobs.get(jobId)?.cancelRequested === true;
}

// Usado depois que um upload que já estava em andamento termina e a
// mensagem correspondente é apagada do Telegram (soft-cancel).
function finalizeCancelledJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'cancelled';
  scheduleCleanup(jobId);
}

export {
  completeJob,
  createJob,
  failJob,
  finalizeCancelledJob,
  getJob,
  isCancelRequested,
  requestCancel,
  setProgress,
  startJob,
};
export type { UploadJob, UploadJobStatus };
