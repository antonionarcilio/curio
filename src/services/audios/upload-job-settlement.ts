import { audioUploadJobStore } from '@/services/audios/upload-progress-store';
import { createUploadJobSettler } from '@/services/create-upload-job-settler';
import { deleteMessage } from '@/telegram-client';

export const settleUploadJob = createUploadJobSettler(audioUploadJobStore, deleteMessage, 'audio');
