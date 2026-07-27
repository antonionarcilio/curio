import { client, ensureConnected } from '@/telegram-client';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { pollUploadJobUntilSettled } from './helpers/upload-fixture';
import {
  buildSmallThumbnailBuffer,
  deleteFixtureViaApi,
  ORIGINAL_DESCRIPTION,
  TARGETS,
  TEST_FILE_NAME,
  TEST_VIDEO_PATH,
} from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

describe.each(TARGETS)('POST /api/v1/video/upload/:chatId (e2e) — $label', ({ chatId }) => {
  let uploadedMessageId: number | undefined;

  afterAll(async () => {
    if (uploadedMessageId) await deleteFixtureViaApi(chatId, uploadedMessageId);
  });

  it('uploads the real video with a resized thumbnail and returns matching metadata', async () => {
    const videoBuffer = fs.readFileSync(TEST_VIDEO_PATH);
    const thumbnailBuffer = await buildSmallThumbnailBuffer();

    const res = await authed(request(app).post(`/api/v1/video/upload/${chatId}`))
      .field('description', ORIGINAL_DESCRIPTION)
      .attach('file', videoBuffer, { filename: path.basename(TEST_VIDEO_PATH), contentType: 'video/mp4' })
      .attach('thumbnail', thumbnailBuffer, { filename: 'thumb.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('queued');
    expect(typeof res.body.job_id).toBe('string');

    const job = await pollUploadJobUntilSettled(res.body.job_id);
    uploadedMessageId = job.message_id;

    expect(job.status).toBe('completed');
    expect(job.chat_id).toBe(chatId);
    expect(job.file_name).toBe(TEST_FILE_NAME);
    expect(job.mime_type).toMatch(/^video\//);
    expect(job.size).toBeGreaterThan(0);
    expect(job.url).toMatch(/^http:\/\/.+\/api\/v1\/video\/stream\/.+\?exp=\d+&sig=[0-9a-f]+$/);
  });
});
