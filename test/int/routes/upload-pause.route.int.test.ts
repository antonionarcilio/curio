import pauseRouter from '@/routes/video/upload-pause/route';
import { completeJob, createJob, getJob, pauseJob, startJob } from '@/services/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(pauseRouter);

describe('POST /video/upload/pause/:jobId', () => {
  it('returns 404 for an unknown job id', async () => {
    const res = await request(buildApp()).post('/video/upload/pause/unknown-job');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('pauses a queued job', async () => {
    createJob('pause-queued', 'me');

    const res = await request(buildApp()).post('/video/upload/pause/pause-queued');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'pause-queued', status: 'paused' });
    expect(getJob('pause-queued')?.status).toBe('paused');
  });

  it('returns 409 for a job already uploading', async () => {
    createJob('pause-uploading', 'me');
    startJob('pause-uploading');

    const res = await request(buildApp()).post('/video/upload/pause/pause-uploading');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('returns 409 for a job already paused', async () => {
    createJob('pause-paused', 'me');
    pauseJob('pause-paused');

    const res = await request(buildApp()).post('/video/upload/pause/pause-paused');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('returns 409 for a job already completed', async () => {
    createJob('pause-completed', 'me');
    completeJob('pause-completed', {
      message_id: 1,
      file_name: 'a.mp4',
      size: 10,
      mime_type: 'video/mp4',
      date: 1,
      url: 'http://x',
    });

    const res = await request(buildApp()).post('/video/upload/pause/pause-completed');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });
});
