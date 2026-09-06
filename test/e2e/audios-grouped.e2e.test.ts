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

describe.each(TARGETS)('GET /api/v1/audios/grouped (e2e) — $label', ({ chatId }) => {
  // `/audios/grouped` percorre getDialogs() e usa o chat_id resolvido de cada
  // diálogo — pra "me" (Saved Messages) isso é o ID numérico real da própria
  // conta, nunca a string "me". Descobrir o chat_id real via file_name
  // (único do fixture) evita assumir que `chat_id === chatId` vale pro alvo "me".
  let realChatId: string;
  let messageId: number;

  beforeAll(async () => {
    const job = await uploadTestAudioFixture(chatId, TEST_AUDIO_PATH, { description: ORIGINAL_AUDIO_DESCRIPTION });
    if (job.status !== 'completed' || !job.message_id) throw new Error(`Falha ao criar fixture para "${chatId}"`);
    messageId = job.message_id;

    const res = await authed(request(app).get('/api/v1/audios/grouped')).query({
      limit: 200,
      file_name: TEST_AUDIO_FILE_NAME,
    });
    const item = res.body.find((entry: { message_id: number }) => entry.message_id === messageId);
    if (!item) throw new Error(`Fixture "${chatId}" não apareceu em /audios/grouped?file_name=${TEST_AUDIO_FILE_NAME}`);
    realChatId = item.chat_id;
  });

  afterAll(async () => {
    if (messageId) await deleteAudioFixtureViaApi(chatId, messageId);
  });

  it('finds the uploaded fixture with no query params, in the lean shape', async () => {
    const res = await authed(request(app).get('/api/v1/audios/grouped')).query({ limit: 200 });

    expect(res.status).toBe(200);
    const item = res.body.find((entry: { message_id: number }) => entry.message_id === messageId);
    expect(item).toMatchObject({
      chat_id: realChatId,
      file_name: TEST_AUDIO_FILE_NAME,
      mime_type: expect.stringMatching(/^audio\//),
    });
    expect(item.thumbnail).toBeUndefined();
    expect(item.duration).toBeUndefined();
    expect(item.url).toMatch(/^http:\/\/.+\/api\/v1\/audio\/stream\/.+\?exp=\d+&sig=[0-9a-f]+$/);
  });

  it('filters by chat_id', async () => {
    const res = await authed(request(app).get('/api/v1/audios/grouped')).query({ limit: 200, chat_id: realChatId });

    expect(res.body.every((entry: { chat_id: string }) => entry.chat_id === realChatId)).toBe(true);
    expect(res.body.some((entry: { message_id: number }) => entry.message_id === messageId)).toBe(true);
  });

  it('filters by file_name', async () => {
    const res = await authed(request(app).get('/api/v1/audios/grouped')).query({
      limit: 200,
      chat_id: realChatId,
      file_name: TEST_AUDIO_FILE_NAME,
    });

    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((entry: { file_name: string }) => entry.file_name === TEST_AUDIO_FILE_NAME)).toBe(true);
  });

  it('returns a paginated envelope when page/per_page are given', async () => {
    const res = await authed(request(app).get('/api/v1/audios/grouped')).query({
      limit: 200,
      chat_id: realChatId,
      page: 1,
      per_page: 5,
    });

    expect(res.body).toMatchObject({ page: 1, per_page: 5 });
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});
