import { createUploadJobStore } from '@/services/create-upload-job-store';
import type { VideoListItem } from '@/telegram-client';

// Job-store de vídeo — independente do de áudio (src/services/audios/upload-progress-store.ts),
// cada um com seu próprio Map e escopo de pause-all/cancel.
export const videoUploadJobStore = createUploadJobStore<VideoListItem & { url: string }>();

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
} = videoUploadJobStore;
