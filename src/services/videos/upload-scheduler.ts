import config from '@/config';
import { createUploadScheduler } from '@/services/create-upload-scheduler';
import { videoUploadJobStore } from '@/services/upload-progress-store';
import type { VideoListItem } from '@/telegram-client';

// Fila própria (independente da de áudio, em src/services/audios/upload-scheduler.ts),
// mas com o mesmo teto de concorrência (UPLOAD_CONCURRENCY_LIMIT) — ver
// comentário lá para o trade-off (o total combinado pode chegar ao dobro do
// valor configurado).
export const videoUploadScheduler = createUploadScheduler<VideoListItem>({
  concurrencyLimit: config.uploadConcurrencyLimit,
  store: videoUploadJobStore,
});

export const { enqueueUpload, notifyQueueChanged, removeFromQueue } = videoUploadScheduler;
