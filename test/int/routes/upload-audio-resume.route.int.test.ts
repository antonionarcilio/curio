import resumeRouter from '@/routes/audio/upload-resume/route';
import { createJob, getJob, pauseJob } from '@/services/audios/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(resumeRouter);

describe('POST /audio/upload/resume/:jobId', () => {
  it('returns 404 for an unknown job id', async () => {
    const res = await request(buildApp()).post('/audio/upload/resume/unknown-job');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('resumes a paused job', async () => {
    createJob('audio-resume-paused', 'me');
    pauseJob('audio-resume-paused');

    const res = await request(buildApp()).post('/audio/upload/resume/audio-resume-paused');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'audio-resume-paused', status: 'queued' });
    expect(getJob('audio-resume-paused')?.status).toBe('queued');
  });

  it('returns 409 for a job that is not paused', async () => {
    createJob('audio-resume-queued', 'me');

    const res = await request(buildApp()).post('/audio/upload/resume/audio-resume-queued');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });
});
