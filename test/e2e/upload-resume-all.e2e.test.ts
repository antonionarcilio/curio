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

describe.each(TARGETS)('POST /api/v1/video/upload/resume (e2e) — $label', ({ chatId }) => {
  let occupyingJobId: string;
  let firstResumedJobId: string;
  let secondResumedJobId: string;

  afterAll(async () => {
    for (const jobId of [occupyingJobId, firstResumedJobId, secondResumedJobId]) {
      try {
        const job = await pollJobStatus(jobId, ['completed', 'error']);
        if (job.status === 'completed' && job.message_id) await deleteFixtureViaApi(chatId, job.message_id);
      } catch {
        // segue mesmo se a limpeza falhar — não deixa o afterAll quebrar a suíte.
      }
    }
  });

  it('resumes every currently paused job at once, and they all upload for real', async () => {
    occupyingJobId = await startUpload(chatId);
    await pollJobStatus(occupyingJobId, ['uploading']);

    firstResumedJobId = await startUpload(chatId);
    secondResumedJobId = await startUpload(chatId);
    await pollJobStatus(firstResumedJobId, ['queued']);
    await pollJobStatus(secondResumedJobId, ['queued']);

    const pauseAllRes = await authed(request(app).post('/api/v1/video/upload/pause'));
    expect(pauseAllRes.body.paused_job_ids).toEqual(expect.arrayContaining([firstResumedJobId, secondResumedJobId]));

    await pollJobStatus(occupyingJobId, ['completed', 'error']);

    const resumeAllRes = await authed(request(app).post('/api/v1/video/upload/resume'));
    expect(resumeAllRes.status).toBe(200);
    expect(resumeAllRes.body.resumed_job_ids).toEqual(expect.arrayContaining([firstResumedJobId, secondResumedJobId]));

    const firstSettled = await pollJobStatus(firstResumedJobId, ['completed', 'error']);
    const secondSettled = await pollJobStatus(secondResumedJobId, ['completed', 'error']);
    expect(firstSettled.status).toBe('completed');
    expect(secondSettled.status).toBe('completed');
  });
});
