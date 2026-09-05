import cancelRouter from '@/routes/audio/upload-cancel/route';
import {
  completeJob,
  createJob,
  failJob,
  getJob,
  pauseJob,
  requestCancel,
  startJob,
} from '@/services/audios/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(cancelRouter);

describe('POST /audio/upload/cancel/:jobId', () => {
  it('returns 404 for an unknown job id', async () => {
    const res = await request(buildApp()).post('/audio/upload/cancel/unknown-job');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('cancels a queued job immediately', async () => {
    createJob('audio-cancel-queued', 'me');

    const res = await request(buildApp()).post('/audio/upload/cancel/audio-cancel-queued');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'audio-cancel-queued', status: 'cancelled' });
    expect(getJob('audio-cancel-queued')?.status).toBe('cancelled');
  });

  it('cancels a paused job immediately, same as a queued one', async () => {
    createJob('audio-cancel-paused', 'me');
    pauseJob('audio-cancel-paused');

    const res = await request(buildApp()).post('/audio/upload/cancel/audio-cancel-paused');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'audio-cancel-paused', status: 'cancelled' });
    expect(getJob('audio-cancel-paused')?.status).toBe('cancelled');
  });

  it('flags an uploading job for cancellation without ending the upload', async () => {
    createJob('audio-cancel-uploading', 'me');
    startJob('audio-cancel-uploading');

    const res = await request(buildApp()).post('/audio/upload/cancel/audio-cancel-uploading');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job_id: 'audio-cancel-uploading', status: 'uploading' });
    expect(getJob('audio-cancel-uploading')).toMatchObject({ status: 'uploading', cancelRequested: true });
  });

  it('returns 409 for a job already completed', async () => {
    createJob('audio-cancel-completed', 'me');
    completeJob('audio-cancel-completed', {
      message_id: 1,
      file_name: 'a.mp3',
      size: 10,
      mime_type: 'audio/mpeg',
      date: 1,
      url: 'http://x',
    });

    const res = await request(buildApp()).post('/audio/upload/cancel/audio-cancel-completed');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('returns 409 for a job already failed', async () => {
    createJob('audio-cancel-error', 'me');
    failJob('audio-cancel-error', 'boom');

    const res = await request(buildApp()).post('/audio/upload/cancel/audio-cancel-error');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('returns 409 for a job already cancelled', async () => {
    createJob('audio-cancel-cancelled', 'me');
    requestCancel('audio-cancel-cancelled');

    const res = await request(buildApp()).post('/audio/upload/cancel/audio-cancel-cancelled');

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });
});
