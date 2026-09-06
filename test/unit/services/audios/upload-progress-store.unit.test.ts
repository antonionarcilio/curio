import { audioUploadJobStore, completeJob, createJob, getJob } from '@/services/audios/upload-progress-store';
import { videoUploadJobStore } from '@/services/upload-progress-store';

describe('audios/upload-progress-store', () => {
  it('creates a job in queued status with progress 0', () => {
    createJob('audio-job1', 'me');
    expect(getJob('audio-job1')).toEqual({ status: 'queued', progress: 0, chatId: 'me' });
  });

  it('completeJob sets status/progress/result', () => {
    createJob('audio-job2', 'me');
    const result = { message_id: 1, file_name: 'a.mp3', size: 10, mime_type: 'audio/mpeg', date: 1, url: 'http://x' };
    completeJob('audio-job2', result);
    expect(getJob('audio-job2')).toEqual({ status: 'completed', progress: 1, chatId: 'me', result });
  });

  it('is a separate store instance from the video job store', () => {
    expect(audioUploadJobStore).not.toBe(videoUploadJobStore);

    createJob('shared-name', 'audio-chat');
    expect(videoUploadJobStore.getJob('shared-name')).toBeUndefined();
  });
});
