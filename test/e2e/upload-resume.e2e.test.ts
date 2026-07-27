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
  mime_type?: string;
  size?: number;
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

describe.each(TARGETS)('POST /api/v1/video/upload/resume/:jobId (e2e) — $label', ({ chatId }) => {
  let occupyingJobId: string;
  let resumedJobId: string;

  afterAll(async () => {
    for (const jobId of [occupyingJobId, resumedJobId]) {
      try {
        const job = await pollJobStatus(jobId, ['completed', 'error']);
        if (job.status === 'completed' && job.message_id) await deleteFixtureViaApi(chatId, job.message_id);
      } catch {
        // segue mesmo se a limpeza falhar — não deixa o afterAll quebrar a suíte.
      }
    }
  });

  it('resumes a paused job, which then uploads for real and completes', async () => {
    occupyingJobId = await startUpload(chatId);
    await pollJobStatus(occupyingJobId, ['uploading']);

    resumedJobId = await startUpload(chatId);
    await pollJobStatus(resumedJobId, ['queued']);

    const pauseRes = await authed(request(app).post(`/api/v1/video/upload/pause/${resumedJobId}`));
    expect(pauseRes.status).toBe(200);

    await pollJobStatus(occupyingJobId, ['completed', 'error']);

    const resumeRes = await authed(request(app).post(`/api/v1/video/upload/resume/${resumedJobId}`));
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body).toEqual({ job_id: resumedJobId, status: 'queued' });

    const settled = await pollJobStatus(resumedJobId, ['completed', 'error']);
    expect(settled.status).toBe('completed');
    expect(settled.mime_type).toMatch(/^video\//);
    expect(settled.size).toBeGreaterThan(0);
  });
});
