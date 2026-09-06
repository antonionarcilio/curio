import config from '@/config';
import { audioUploadJobStore } from '@/services/audios/upload-progress-store';
import { createUploadScheduler } from '@/services/create-upload-scheduler';
import type { AudioListItem } from '@/telegram-client';

// Fila própria (independente da de vídeo, em src/services/videos/upload-scheduler.ts),
// mas com o mesmo teto de concorrência (UPLOAD_CONCURRENCY_LIMIT) — um upload
// de vídeo em andamento não ocupa a vaga de um upload de áudio, e vice-versa;
// o total combinado pode chegar ao dobro do valor configurado.
export const audioUploadScheduler = createUploadScheduler<AudioListItem>({
  concurrencyLimit: config.uploadConcurrencyLimit,
  store: audioUploadJobStore,
});

export const { enqueueUpload, notifyQueueChanged, removeFromQueue } = audioUploadScheduler;
