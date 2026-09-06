import resumeAllRouter from '@/routes/audio/upload-resume-all/route';
import { createJob, getJob, pauseJob, startJob } from '@/services/audios/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(resumeAllRouter);

describe('POST /audio/upload/resume', () => {
  it('resumes every currently paused job and leaves others untouched', async () => {
    createJob('audio-resume-all-1', 'me');
    pauseJob('audio-resume-all-1');
    createJob('audio-resume-all-2', 'me');
    pauseJob('audio-resume-all-2');
    createJob('audio-resume-all-3', 'me');
    startJob('audio-resume-all-3');

    const res = await request(buildApp()).post('/audio/upload/resume');

    expect(res.status).toBe(200);
    expect(res.body.resumed_job_ids).toEqual(expect.arrayContaining(['audio-resume-all-1', 'audio-resume-all-2']));
    expect(res.body.resumed_job_ids).not.toContain('audio-resume-all-3');
    expect(getJob('audio-resume-all-1')?.status).toBe('queued');
    expect(getJob('audio-resume-all-2')?.status).toBe('queued');
    expect(getJob('audio-resume-all-3')?.status).toBe('uploading');
  });

  it('returns an empty-relative list when nothing is paused', async () => {
    createJob('audio-resume-all-4', 'me');

    const res = await request(buildApp()).post('/audio/upload/resume');

    expect(res.status).toBe(200);
    expect(res.body.resumed_job_ids).not.toContain('audio-resume-all-4');
  });
});
