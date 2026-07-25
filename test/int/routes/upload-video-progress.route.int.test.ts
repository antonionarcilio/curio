import { completeJob, createJob, failJob, setProgress, startJob } from '@/jobs/upload-progress-store';
import progressRouter from '@/routes/video/upload-progress/route';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(progressRouter);

describe('GET /video/upload/progress/:jobId', () => {
  it('returns 404 for an unknown job id', async () => {
    const res = await request(buildApp()).get('/video/upload/progress/unknown-job');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('returns queued status right after creation', async () => {
    createJob('progress-queued', 'me');

    const res = await request(buildApp()).get('/video/upload/progress/progress-queued');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'progress-queued', status: 'queued', progress: 0 });
  });

  it('returns uploading status with the current progress fraction', async () => {
    createJob('progress-uploading', 'me');
    startJob('progress-uploading');
    setProgress('progress-uploading', 0.42);

    const res = await request(buildApp()).get('/video/upload/progress/progress-uploading');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'progress-uploading', status: 'uploading', progress: 0.42 });
  });

  it('returns the video metadata and url when completed', async () => {
    createJob('progress-completed', 'chat1');
    const result = {
      message_id: 7,
      file_name: 'video.mp4',
      size: 123,
      mime_type: 'video/mp4',
      date: 1700000000,
      url: 'http://localhost/api/v1/video/stream/chat1/7',
    };
    completeJob('progress-completed', result);

    const res = await request(buildApp()).get('/video/upload/progress/progress-completed');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      job_id: 'progress-completed',
      status: 'completed',
      progress: 1,
      chat_id: 'chat1',
      ...result,
    });
  });

  it('returns the error message when the job failed', async () => {
    createJob('progress-error', 'me');
    failJob('progress-error', 'boom');

    const res = await request(buildApp()).get('/video/upload/progress/progress-error');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'progress-error', status: 'error', progress: 0, error: 'boom' });
  });
});
