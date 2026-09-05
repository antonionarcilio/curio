import pauseRouter from '@/routes/audio/upload-pause/route';
import { completeJob, createJob, getJob, pauseJob, startJob } from '@/services/audios/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(pauseRouter);

describe('POST /audio/upload/pause/:jobId', () => {
  it('returns 404 for an unknown job id', async () => {
    const res = await request(buildApp()).post('/audio/upload/pause/unknown-job');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('pauses a queued job', async () => {
    createJob('audio-pause-queued', 'me');

    const res = await request(buildApp()).post('/audio/upload/pause/audio-pause-queued');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'audio-pause-queued', status: 'paused' });
    expect(getJob('audio-pause-queued')?.status).toBe('paused');
  });

  it('returns 409 for a job already uploading', async () => {
    createJob('audio-pause-uploading', 'me');
    startJob('audio-pause-uploading');

    const res = await request(buildApp()).post('/audio/upload/pause/audio-pause-uploading');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('returns 409 for a job already paused', async () => {
    createJob('audio-pause-paused', 'me');
    pauseJob('audio-pause-paused');

    const res = await request(buildApp()).post('/audio/upload/pause/audio-pause-paused');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('returns 409 for a job already completed', async () => {
    createJob('audio-pause-completed', 'me');
    completeJob('audio-pause-completed', {
      message_id: 1,
      file_name: 'a.mp3',
      size: 10,
      mime_type: 'audio/mpeg',
      date: 1,
      url: 'http://x',
    });

    const res = await request(buildApp()).post('/audio/upload/pause/audio-pause-completed');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });
});
