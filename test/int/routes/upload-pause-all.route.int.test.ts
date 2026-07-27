import pauseAllRouter from '@/routes/video/upload-pause-all/route';
import { createJob, getJob, pauseJob, startJob } from '@/services/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(pauseAllRouter);

describe('POST /video/upload/pause', () => {
  it('pauses every currently queued job and leaves others untouched', async () => {
    createJob('pause-all-1', 'me');
    createJob('pause-all-2', 'me');
    createJob('pause-all-3', 'me');
    startJob('pause-all-3');

    const res = await request(buildApp()).post('/video/upload/pause');

    expect(res.status).toBe(200);
    expect(res.body.paused_job_ids).toEqual(expect.arrayContaining(['pause-all-1', 'pause-all-2']));
    expect(res.body.paused_job_ids).not.toContain('pause-all-3');
    expect(getJob('pause-all-1')?.status).toBe('paused');
    expect(getJob('pause-all-2')?.status).toBe('paused');
    expect(getJob('pause-all-3')?.status).toBe('uploading');
  });

  it('returns an empty list when nothing is queued', async () => {
    createJob('pause-all-4', 'me');
    pauseJob('pause-all-4');

    const res = await request(buildApp()).post('/video/upload/pause');

    expect(res.status).toBe(200);
    expect(res.body.paused_job_ids).not.toContain('pause-all-4');
  });
});
