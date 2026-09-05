import { client, ensureConnected } from '@/telegram-client';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { deleteAudioFixtureViaApi, TARGETS, TEST_AUDIO_PATH } from './helpers/audio-fixture';
import { app, authed } from './helpers/http-client';

beforeAll(() => ensureConnected());
afterAll(() => client.destroy());

type UploadProgressResponse = {
  status: 'queued' | 'paused' | 'uploading' | 'completed' | 'error' | 'cancelled';
  message_id?: number;
};

async function pollJobStatus(jobId: string, terminalStatuses: string[]): Promise<UploadProgressResponse> {
  for (;;) {
    const res = await authed(request(app).get(`/api/v1/audio/upload/progress/${jobId}`));
    const body = res.body as UploadProgressResponse;
    if (terminalStatuses.includes(body.status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function startUpload(chatId: string): Promise<string> {
  const audioBuffer = fs.readFileSync(TEST_AUDIO_PATH);
  const res = await authed(request(app).post(`/api/v1/audio/upload/${chatId}`)).attach('file', audioBuffer, {
    filename: path.basename(TEST_AUDIO_PATH),
    contentType: 'audio/mpeg',
  });
  return res.body.job_id as string;
}

describe.each(TARGETS)('POST /api/v1/audio/upload/pause (e2e) — $label', ({ chatId }) => {
  let occupyingJobId: string;

  afterAll(async () => {
    try {
      const occupying = await pollJobStatus(occupyingJobId, ['completed', 'error']);
      if (occupying.status === 'completed' && occupying.message_id) {
        await deleteAudioFixtureViaApi(chatId, occupying.message_id);
      }
    } catch {
      // segue mesmo se a limpeza falhar — não deixa o afterAll quebrar a suíte.
    }
  });

  it('pauses every currently queued job at once, and they stay paused after the slot frees up', async () => {
    occupyingJobId = await startUpload(chatId);
    await pollJobStatus(occupyingJobId, ['uploading']);

    const firstQueuedJobId = await startUpload(chatId);
    const secondQueuedJobId = await startUpload(chatId);
    await pollJobStatus(firstQueuedJobId, ['queued']);
    await pollJobStatus(secondQueuedJobId, ['queued']);

    const pauseAllRes = await authed(request(app).post('/api/v1/audio/upload/pause'));
    expect(pauseAllRes.status).toBe(200);
    expect(pauseAllRes.body.paused_job_ids).toEqual(expect.arrayContaining([firstQueuedJobId, secondQueuedJobId]));

    await pollJobStatus(occupyingJobId, ['completed', 'error']);

    const firstAfter = await authed(request(app).get(`/api/v1/audio/upload/progress/${firstQueuedJobId}`));
    const secondAfter = await authed(request(app).get(`/api/v1/audio/upload/progress/${secondQueuedJobId}`));
    expect(firstAfter.body.status).toBe('paused');
    expect(secondAfter.body.status).toBe('paused');
  });
});
