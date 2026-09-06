import { createUploadJobStore } from '@/services/create-upload-job-store';
import type { AudioListItem } from '@/telegram-client';

// Job-store de áudio — independente do de vídeo (src/services/upload-progress-store.ts),
// cada um com seu próprio Map e escopo de pause-all/cancel.
export const audioUploadJobStore = createUploadJobStore<AudioListItem & { url: string }>();

export const {
  createJob,
  startJob,
  setProgress,
  completeJob,
  failJob,
  getJob,
  requestCancel,
  pauseJob,
  resumeJob,
  getJobIdsByStatus,
  isCancelRequested,
  finalizeCancelledJob,
} = audioUploadJobStore;
