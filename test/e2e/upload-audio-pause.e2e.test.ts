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

describe.each(TARGETS)('POST /api/v1/audio/upload/pause/:jobId (e2e) — $label', ({ chatId }) => {
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

  it('pauses a queued job and it stays paused even after a concurrency slot frees up', async () => {
    occupyingJobId = await startUpload(chatId);
    await pollJobStatus(occupyingJobId, ['uploading']);

    const queuedJobId = await startUpload(chatId);
    const beforePause = await pollJobStatus(queuedJobId, ['queued']);
    expect(beforePause.status).toBe('queued');

    const pauseRes = await authed(request(app).post(`/api/v1/audio/upload/pause/${queuedJobId}`));
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body).toEqual({ job_id: queuedJobId, status: 'paused' });

    await pollJobStatus(occupyingJobId, ['completed', 'error']);

    const afterSlotFreed = await authed(request(app).get(`/api/v1/audio/upload/progress/${queuedJobId}`));
    expect(afterSlotFreed.body.status).toBe('paused');
  });
});
