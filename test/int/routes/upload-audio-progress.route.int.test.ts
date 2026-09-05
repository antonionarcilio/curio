import progressRouter from '@/routes/audio/upload-progress/route';
import { completeJob, createJob, failJob, setProgress, startJob } from '@/services/audios/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(progressRouter);

describe('GET /audio/upload/progress/:jobId', () => {
  it('returns 404 for an unknown job id', async () => {
    const res = await request(buildApp()).get('/audio/upload/progress/unknown-job');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('returns queued status right after creation', async () => {
    createJob('audio-progress-queued', 'me');

    const res = await request(buildApp()).get('/audio/upload/progress/audio-progress-queued');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'audio-progress-queued', status: 'queued', progress: 0 });
  });

  it('returns uploading status with the current progress fraction', async () => {
    createJob('audio-progress-uploading', 'me');
    startJob('audio-progress-uploading');
    setProgress('audio-progress-uploading', 0.42);

    const res = await request(buildApp()).get('/audio/upload/progress/audio-progress-uploading');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'audio-progress-uploading', status: 'uploading', progress: 0.42 });
  });

  it('returns the audio metadata and url when completed', async () => {
    createJob('audio-progress-completed', 'chat1');
    const result = {
      message_id: 7,
      file_name: 'song.mp3',
      size: 123,
      mime_type: 'audio/mpeg',
      date: 1700000000,
      url: 'http://localhost/api/v1/audio/stream/chat1/7',
    };
    completeJob('audio-progress-completed', result);

    const res = await request(buildApp()).get('/audio/upload/progress/audio-progress-completed');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      job_id: 'audio-progress-completed',
      status: 'completed',
      progress: 1,
      chat_id: 'chat1',
      ...result,
    });
  });

  it('returns the error message when the job failed', async () => {
    createJob('audio-progress-error', 'me');
    failJob('audio-progress-error', 'boom');

    const res = await request(buildApp()).get('/audio/upload/progress/audio-progress-error');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'audio-progress-error', status: 'error', progress: 0, error: 'boom' });
  });
});
