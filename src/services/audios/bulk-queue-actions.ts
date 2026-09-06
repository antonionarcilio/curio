import { audioUploadJobStore } from '@/services/audios/upload-progress-store';
import { audioUploadScheduler } from '@/services/audios/upload-scheduler';
import { createBulkQueueActions } from '@/services/create-bulk-queue-actions';

export const { pauseAllQueued, resumeAllPaused } = createBulkQueueActions(audioUploadJobStore, audioUploadScheduler);
