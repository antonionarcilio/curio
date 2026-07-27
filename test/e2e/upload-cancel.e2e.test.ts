import { client, ensureConnected } from '@/telegram-client';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { deleteFixtureViaApi, TARGETS, TEST_QUEUE_VIDEO_PATH } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
afterAll(() => client.destroy());

type UploadProgressResponse = {
  status: 'queued' | 'paused' | 'uploading' | 'completed' | 'error' | 'cancelled';
  message_id?: number;
};

async function pollJobStatus(jobId: string, terminalStatuses: string[]): Promise<UploadProgressResponse> {
  for (;;) {
    const res = await authed(request(app).get(`/api/v1/video/upload/progress/${jobId}`));
    const body = res.body as UploadProgressResponse;
    if (terminalStatuses.includes(body.status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function startUpload(chatId: string): Promise<string> {
  const videoBuffer = fs.readFileSync(TEST_QUEUE_VIDEO_PATH);
  const res = await authed(request(app).post(`/api/v1/video/upload/${chatId}`)).attach('file', videoBuffer, {
    filename: path.basename(TEST_QUEUE_VIDEO_PATH),
    contentType: 'video/mp4',
  });
  return res.body.job_id as string;
}

describe.each(TARGETS)('POST /api/v1/video/upload/cancel/:jobId (e2e) — $label', ({ chatId }) => {
  // job "ocupante" (A): sobe de verdade, segura a única vaga de concorrência
  // (UPLOAD_CONCURRENCY_LIMIT=1) enquanto o caso 1 cancela um job atrás dele
  // na fila. É o único job desse arquivo que completa normalmente (sem ser
  // cancelado) — por isso é o único que precisa de limpeza no afterAll.
  let occupyingJobId: string;

  afterAll(async () => {
    try {
      const occupying = await pollJobStatus(occupyingJobId, ['completed', 'error']);
      if (occupying.status === 'completed' && occupying.message_id) {
        await deleteFixtureViaApi(chatId, occupying.message_id);
      }
    } catch {
      // segue mesmo se a limpeza falhar — não deixa o afterAll quebrar a suíte.
    }
  });

  it('cancels a job that is still queued behind an active upload', async () => {
    occupyingJobId = await startUpload(chatId);
    await pollJobStatus(occupyingJobId, ['uploading']);

    const queuedJobId = await startUpload(chatId);
    const beforeCancel = await pollJobStatus(queuedJobId, ['queued']);
    expect(beforeCancel.status).toBe('queued');

    const cancelRes = await authed(request(app).post(`/api/v1/video/upload/cancel/${queuedJobId}`));
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body).toEqual({ job_id: queuedJobId, status: 'cancelled' });

    const afterCancel = await pollJobStatus(queuedJobId, ['cancelled']);
    expect(afterCancel.status).toBe('cancelled');
  });

  it('soft-cancels an upload already in progress: deletes the message instead of completing the job', async () => {
    await pollJobStatus(occupyingJobId, ['completed', 'error']);

    const jobId = await startUpload(chatId);
    await pollJobStatus(jobId, ['uploading']);

    const cancelRes = await authed(request(app).post(`/api/v1/video/upload/cancel/${jobId}`));
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body).toEqual({ job_id: jobId, status: 'uploading' });

    const settled = await pollJobStatus(jobId, ['cancelled', 'error']);
    expect(settled.status).toBe('cancelled');

    if (settled.message_id) {
      const streamRes = await authed(request(app).get(`/api/v1/video/stream/${chatId}/${settled.message_id}`));
      expect(streamRes.status).toBe(404);
    }
  });
});
