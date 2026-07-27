import resumeAllRouter from '@/routes/video/upload-resume-all/route';
import { createJob, getJob, pauseJob, startJob } from '@/services/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(resumeAllRouter);

describe('POST /video/upload/resume', () => {
  it('resumes every currently paused job and leaves others untouched', async () => {
    createJob('resume-all-1', 'me');
    pauseJob('resume-all-1');
    createJob('resume-all-2', 'me');
    pauseJob('resume-all-2');
    createJob('resume-all-3', 'me');
    startJob('resume-all-3');

    const res = await request(buildApp()).post('/video/upload/resume');

    expect(res.status).toBe(200);
    expect(res.body.resumed_job_ids).toEqual(expect.arrayContaining(['resume-all-1', 'resume-all-2']));
    expect(res.body.resumed_job_ids).not.toContain('resume-all-3');
    expect(getJob('resume-all-1')?.status).toBe('queued');
    expect(getJob('resume-all-2')?.status).toBe('queued');
    expect(getJob('resume-all-3')?.status).toBe('uploading');
  });

  it('returns an empty-relative list when nothing is paused', async () => {
    createJob('resume-all-4', 'me');

    const res = await request(buildApp()).post('/video/upload/resume');

    expect(res.status).toBe(200);
    expect(res.body.resumed_job_ids).not.toContain('resume-all-4');
  });
});
