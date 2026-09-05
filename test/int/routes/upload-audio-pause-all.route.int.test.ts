import pauseAllRouter from '@/routes/audio/upload-pause-all/route';
import { createJob, getJob, pauseJob, startJob } from '@/services/audios/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(pauseAllRouter);

describe('POST /audio/upload/pause', () => {
  it('pauses every currently queued job and leaves others untouched', async () => {
    createJob('audio-pause-all-1', 'me');
    createJob('audio-pause-all-2', 'me');
    createJob('audio-pause-all-3', 'me');
    startJob('audio-pause-all-3');

    const res = await request(buildApp()).post('/audio/upload/pause');

    expect(res.status).toBe(200);
    expect(res.body.paused_job_ids).toEqual(expect.arrayContaining(['audio-pause-all-1', 'audio-pause-all-2']));
    expect(res.body.paused_job_ids).not.toContain('audio-pause-all-3');
    expect(getJob('audio-pause-all-1')?.status).toBe('paused');
    expect(getJob('audio-pause-all-2')?.status).toBe('paused');
    expect(getJob('audio-pause-all-3')?.status).toBe('uploading');
  });

  it('returns an empty list when nothing is queued', async () => {
    createJob('audio-pause-all-4', 'me');
    pauseJob('audio-pause-all-4');

    const res = await request(buildApp()).post('/audio/upload/pause');

    expect(res.status).toBe(200);
    expect(res.body.paused_job_ids).not.toContain('audio-pause-all-4');
  });
});
