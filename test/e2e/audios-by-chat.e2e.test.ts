import { client, ensureConnected } from '@/telegram-client';
import request from 'supertest';
import {
  deleteAudioFixtureViaApi,
  ORIGINAL_AUDIO_DESCRIPTION,
  TARGETS,
  TEST_AUDIO_FILE_NAME,
  TEST_AUDIO_PATH,
} from './helpers/audio-fixture';
import { app, authed } from './helpers/http-client';
import { uploadTestAudioFixture } from './helpers/upload-audio-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

describe.each(TARGETS)('GET /api/v1/audios/by/:chatId (e2e) — $label', ({ chatId }) => {
  let messageId: number;

  beforeAll(async () => {
    const job = await uploadTestAudioFixture(chatId, TEST_AUDIO_PATH, { description: ORIGINAL_AUDIO_DESCRIPTION });
    if (job.status !== 'completed' || !job.message_id) throw new Error(`Falha ao criar fixture para "${chatId}"`);
    messageId = job.message_id;
  });

  afterAll(async () => {
    if (messageId) await deleteAudioFixtureViaApi(chatId, messageId);
  });

  it('returns the rich item shape with duration/title/performer and thumbnail: null (no embedded album art)', async () => {
    const res = await authed(request(app).get(`/api/v1/audios/by/${chatId}`)).query({ limit: 200 });

    expect(res.status).toBe(200);
    expect(res.body.chat_id).toBe(chatId);
    const item = res.body.data.find((entry: { message_id: number }) => entry.message_id === messageId);
    expect(item).toMatchObject({
      file_name: TEST_AUDIO_FILE_NAME,
      description: ORIGINAL_AUDIO_DESCRIPTION,
      duration: expect.any(Number),
      title: 'Sample Audio Fixture',
      performer: 'api-tg-cdn e2e',
      thumbnail: null,
    });
    expect(item.duration).toBeGreaterThan(0);
  });

  it('filters by file_name', async () => {
    const res = await authed(request(app).get(`/api/v1/audios/by/${chatId}`)).query({
      limit: 200,
      file_name: TEST_AUDIO_FILE_NAME,
    });

    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((entry: { file_name: string }) => entry.file_name === TEST_AUDIO_FILE_NAME)).toBe(true);
  });

  it('accepts thumbnail=true without failing, staying null since the fixture has no embedded album art', async () => {
    const res = await authed(request(app).get(`/api/v1/audios/by/${chatId}`)).query({
      limit: 200,
      thumbnail: 'true',
    });

    const item = res.body.data.find((entry: { message_id: number }) => entry.message_id === messageId);
    expect(res.status).toBe(200);
    expect(item.thumbnail).toBeNull();
  });

  it('returns a paginated envelope when page/per_page are given', async () => {
    const res = await authed(request(app).get(`/api/v1/audios/by/${chatId}`)).query({
      limit: 200,
      page: 1,
      per_page: 5,
    });

    expect(res.body).toMatchObject({ chat_id: chatId, page: 1, per_page: 5 });
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('combines file_name with pagination', async () => {
    const res = await authed(request(app).get(`/api/v1/audios/by/${chatId}`)).query({
      limit: 200,
      file_name: TEST_AUDIO_FILE_NAME,
      page: 1,
      per_page: 5,
    });

    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((entry: { file_name: string }) => entry.file_name === TEST_AUDIO_FILE_NAME)).toBe(true);
  });
});
