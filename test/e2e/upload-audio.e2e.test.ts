import { client, ensureConnected } from '@/telegram-client';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import {
  buildSmallThumbnailBuffer,
  deleteAudioFixtureViaApi,
  ORIGINAL_AUDIO_DESCRIPTION,
  TARGETS,
  TEST_AUDIO_FILE_NAME,
  TEST_AUDIO_PATH,
} from './helpers/audio-fixture';
import { app, authed } from './helpers/http-client';
import { pollUploadAudioJobUntilSettled } from './helpers/upload-audio-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

describe.each(TARGETS)('POST /api/v1/audio/upload/:chatId (e2e) — $label', ({ chatId }) => {
  let uploadedMessageId: number | undefined;

  afterAll(async () => {
    if (uploadedMessageId) await deleteAudioFixtureViaApi(chatId, uploadedMessageId);
  });

  it('uploads the real audio file with a cover and returns matching metadata', async () => {
    const audioBuffer = fs.readFileSync(TEST_AUDIO_PATH);
    const coverBuffer = await buildSmallThumbnailBuffer();

    const res = await authed(request(app).post(`/api/v1/audio/upload/${chatId}`))
      .field('description', ORIGINAL_AUDIO_DESCRIPTION)
      .attach('file', audioBuffer, { filename: path.basename(TEST_AUDIO_PATH), contentType: 'audio/mpeg' })
      .attach('thumbnail', coverBuffer, { filename: 'cover.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('queued');
    expect(typeof res.body.job_id).toBe('string');

    const job = await pollUploadAudioJobUntilSettled(res.body.job_id);
    uploadedMessageId = job.message_id;

    expect(job.status).toBe('completed');
    expect(job.chat_id).toBe(chatId);
    expect(job.file_name).toBe(TEST_AUDIO_FILE_NAME);
    expect(job.mime_type).toMatch(/^audio\//);
    expect(job.size).toBeGreaterThan(0);
    expect(job.url).toMatch(/^http:\/\/.+\/api\/v1\/audio\/stream\/.+\?exp=\d+&sig=[0-9a-f]+$/);
  });

  it('serves the uploaded cover back via ?thumbnail=true', async () => {
    const res = await authed(request(app).get(`/api/v1/audios/by/${chatId}`)).query({ thumbnail: 'true', limit: 20 });

    expect(res.status).toBe(200);
    const uploaded = res.body.data.find((item: { message_id: number }) => item.message_id === uploadedMessageId);
    expect(uploaded).toBeDefined();
    expect(uploaded.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(typeof uploaded.thumbnail_width).toBe('number');
    expect(typeof uploaded.thumbnail_height).toBe('number');
  });
});
