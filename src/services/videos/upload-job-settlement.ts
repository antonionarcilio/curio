import { createUploadJobSettler } from '@/services/create-upload-job-settler';
import { videoUploadJobStore } from '@/services/upload-progress-store';
import { deleteMessage } from '@/telegram-client';

export const settleUploadJob = createUploadJobSettler(videoUploadJobStore, deleteMessage, 'video');
