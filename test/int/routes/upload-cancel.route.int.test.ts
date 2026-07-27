import cancelRouter from '@/routes/video/upload-cancel/route';
import {
  completeJob,
  createJob,
  failJob,
  getJob,
  pauseJob,
  requestCancel,
  startJob,
} from '@/services/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(cancelRouter);

describe('POST /video/upload/cancel/:jobId', () => {
  it('returns 404 for an unknown job id', async () => {
    const res = await request(buildApp()).post('/video/upload/cancel/unknown-job');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('cancels a queued job immediately', async () => {
    createJob('cancel-queued', 'me');

    const res = await request(buildApp()).post('/video/upload/cancel/cancel-queued');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'cancel-queued', status: 'cancelled' });
    expect(getJob('cancel-queued')?.status).toBe('cancelled');
  });

  it('cancels a paused job immediately, same as a queued one', async () => {
    createJob('cancel-paused', 'me');
    pauseJob('cancel-paused');

    const res = await request(buildApp()).post('/video/upload/cancel/cancel-paused');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'cancel-paused', status: 'cancelled' });
    expect(getJob('cancel-paused')?.status).toBe('cancelled');
  });

  it('flags an uploading job for cancellation without ending the upload', async () => {
    createJob('cancel-uploading', 'me');
    startJob('cancel-uploading');

    const res = await request(buildApp()).post('/video/upload/cancel/cancel-uploading');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'cancel-uploading', status: 'uploading' });
    expect(getJob('cancel-uploading')).toMatchObject({ status: 'uploading', cancelRequested: true });
  });

  it('returns 409 for a job already completed', async () => {
    createJob('cancel-completed', 'me');
    completeJob('cancel-completed', {
      message_id: 1,
      file_name: 'a.mp4',
      size: 10,
      mime_type: 'video/mp4',
      date: 1,
      url: 'http://x',
    });

    const res = await request(buildApp()).post('/video/upload/cancel/cancel-completed');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('returns 409 for a job already failed', async () => {
    createJob('cancel-error', 'me');
    failJob('cancel-error', 'boom');

    const res = await request(buildApp()).post('/video/upload/cancel/cancel-error');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('returns 409 for a job already cancelled', async () => {
    createJob('cancel-cancelled', 'me');
    requestCancel('cancel-cancelled');

    const res = await request(buildApp()).post('/video/upload/cancel/cancel-cancelled');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });
});
