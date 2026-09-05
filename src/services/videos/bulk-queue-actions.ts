import { createBulkQueueActions } from '@/services/create-bulk-queue-actions';
import { videoUploadJobStore } from '@/services/upload-progress-store';
import { videoUploadScheduler } from '@/services/videos/upload-scheduler';

export const { pauseAllQueued, resumeAllPaused } = createBulkQueueActions(videoUploadJobStore, videoUploadScheduler);
