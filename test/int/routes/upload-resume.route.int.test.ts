import resumeRouter from '@/routes/video/upload-resume/route';
import { createJob, getJob, pauseJob } from '@/services/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(resumeRouter);

describe('POST /video/upload/resume/:jobId', () => {
  it('returns 404 for an unknown job id', async () => {
    const res = await request(buildApp()).post('/video/upload/resume/unknown-job');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('resumes a paused job', async () => {
    createJob('resume-paused', 'me');
    pauseJob('resume-paused');

    const res = await request(buildApp()).post('/video/upload/resume/resume-paused');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'resume-paused', status: 'queued' });
    expect(getJob('resume-paused')?.status).toBe('queued');
  });

  it('returns 409 for a job that is not paused', async () => {
    createJob('resume-queued', 'me');

    const res = await request(buildApp()).post('/video/upload/resume/resume-queued');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });
});
