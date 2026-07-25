import { client, ensureConnected } from '@/telegram-client';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { readFixtureState } from './helpers/shared-state';
import { TARGETS, TEST_FILE_NAME } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() (não disconnect()) marca client._destroyed = true — sem isso o
// _updateLoop interno do GramJS continua acordando a cada 9s pra pingar um
// sender já desconectado, gerando "[Error: TIMEOUT]"/"Cannot log after tests
// are done" indefinidamente e travando o processo do Jest aberto no final.
afterAll(() => client.destroy());

describe.each(TARGETS)('GET /api/v1/videos/grouped (e2e) — $label', ({ chatId }) => {
  // `/videos/grouped` percorre getDialogs() e usa o chat_id resolvido de cada
  // diálogo — pra "me" (Saved Messages) isso é o ID numérico real da própria
  // conta, nunca a string "me" (só rotas que repassam o chatId direto pro
  // GramJS, como upload/update/delete/stream, reconhecem esse atalho).
  // Descobrir o chat_id real via file_name (único do fixture) evita assumir
  // que `chat_id === chatId` vale pro alvo "me".
  let realChatId: string;

  beforeAll(async () => {
    const fixture = readFixtureState(chatId);
    if (!fixture) throw new Error(`Fixture ausente para "${chatId}" — upload-video.e2e.test.ts precisa rodar antes`);

    const res = await authed(request(app).get('/api/v1/videos/grouped')).query({
      limit: 200,
      file_name: TEST_FILE_NAME,
    });
    const item = res.body.find((entry: { message_id: number }) => entry.message_id === fixture.messageId);
    if (!item) throw new Error(`Fixture "${chatId}" não apareceu em /videos/grouped?file_name=${TEST_FILE_NAME}`);
    realChatId = item.chat_id;
  });

  it('finds the uploaded fixture with no query params, in the lean shape', async () => {
    const fixture = readFixtureState(chatId);
    if (!fixture) throw new Error(`Fixture ausente para "${chatId}" — upload-video.e2e.test.ts precisa rodar antes`);

    const res = await authed(request(app).get('/api/v1/videos/grouped')).query({ limit: 200 });

    expect(res.status).toBe(200);
    const item = res.body.find((entry: { message_id: number }) => entry.message_id === fixture.messageId);
    expect(item).toMatchObject({
      chat_id: realChatId,
      file_name: TEST_FILE_NAME,
      mime_type: expect.stringMatching(/^video\//),
    });
    expect(item.thumbnail).toBeUndefined();
    expect(item.duration).toBeUndefined();
    expect(item.url).toMatch(/^http:\/\/.+\/api\/v1\/video\/stream\/.+\?exp=\d+&sig=[0-9a-f]+$/);
  });

  it('filters by chat_id', async () => {
    const fixture = readFixtureState(chatId);
    if (!fixture) throw new Error(`Fixture ausente para "${chatId}" — upload-video.e2e.test.ts precisa rodar antes`);

    const res = await authed(request(app).get('/api/v1/videos/grouped')).query({ limit: 200, chat_id: realChatId });

    expect(res.body.every((entry: { chat_id: string }) => entry.chat_id === realChatId)).toBe(true);
    expect(res.body.some((entry: { message_id: number }) => entry.message_id === fixture.messageId)).toBe(true);
  });

  it('filters by chat_title (discovered dynamically from the unfiltered listing)', async () => {
    const unfiltered = await authed(request(app).get('/api/v1/videos/grouped')).query({
      limit: 200,
      chat_id: realChatId,
    });
    expect(unfiltered.body.length).toBeGreaterThan(0);
    const chatTitle = unfiltered.body[0].chat_title as string;

    const res = await authed(request(app).get('/api/v1/videos/grouped')).query({ limit: 200, chat_title: chatTitle });

    expect(res.body.some((entry: { chat_id: string }) => entry.chat_id === realChatId)).toBe(true);
  });

  it('filters by file_name', async () => {
    const res = await authed(request(app).get('/api/v1/videos/grouped')).query({
      limit: 200,
      chat_id: realChatId,
      file_name: TEST_FILE_NAME,
    });

    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((entry: { file_name: string }) => entry.file_name === TEST_FILE_NAME)).toBe(true);
  });

  it('returns a paginated envelope when page/per_page are given', async () => {
    const res = await authed(request(app).get('/api/v1/videos/grouped')).query({
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
