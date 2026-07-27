import { client, ensureConnected } from '@/telegram-client';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { uploadTestFixture } from './helpers/upload-fixture';
import {
  buildSmallThumbnailBuffer,
  deleteFixtureViaApi,
  ORIGINAL_DESCRIPTION,
  TARGETS,
  TEST_QUEUE_FILE_NAME,
  TEST_QUEUE_VIDEO_PATH,
} from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

describe.each(TARGETS)('GET /api/v1/videos/by/:chatId (e2e) — $label', ({ chatId }) => {
  let messageId: number;

  beforeAll(async () => {
    const thumbnailBuffer = await buildSmallThumbnailBuffer();
    const job = await uploadTestFixture(chatId, TEST_QUEUE_VIDEO_PATH, {
      description: ORIGINAL_DESCRIPTION,
      thumbnail: thumbnailBuffer,
    });
    if (job.status !== 'completed' || !job.message_id) throw new Error(`Falha ao criar fixture para "${chatId}"`);
    messageId = job.message_id;
  });

  afterAll(async () => {
    if (messageId) await deleteFixtureViaApi(chatId, messageId);
  });

  it('returns the rich item shape with thumbnail: null by default', async () => {
    const res = await authed(request(app).get(`/api/v1/videos/by/${chatId}`)).query({ limit: 200 });

    expect(res.status).toBe(200);
    expect(res.body.chat_id).toBe(chatId);
    const item = res.body.data.find((entry: { message_id: number }) => entry.message_id === messageId);
    expect(item).toMatchObject({
      file_name: TEST_QUEUE_FILE_NAME,
      description: ORIGINAL_DESCRIPTION,
      duration: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
      supports_streaming: true,
      thumbnail_width: expect.any(Number),
      thumbnail_height: expect.any(Number),
      thumbnail: null,
    });
    expect(item.duration).toBeGreaterThan(0);
  });

  it('filters by file_name', async () => {
    const res = await authed(request(app).get(`/api/v1/videos/by/${chatId}`)).query({
      limit: 200,
      file_name: TEST_QUEUE_FILE_NAME,
    });

    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((entry: { file_name: string }) => entry.file_name === TEST_QUEUE_FILE_NAME)).toBe(true);
  });

  it('downloads a real thumbnail when thumbnail=true', async () => {
    const res = await authed(request(app).get(`/api/v1/videos/by/${chatId}`)).query({
      limit: 200,
      thumbnail: 'true',
    });

    const item = res.body.data.find((entry: { message_id: number }) => entry.message_id === messageId);
    expect(item.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(item.thumbnail.length).toBeGreaterThan(1000);
    expect(item.thumbnail_width).toBeGreaterThan(0);
  });

  it('returns a paginated envelope when page/per_page are given', async () => {
    const res = await authed(request(app).get(`/api/v1/videos/by/${chatId}`)).query({
      limit: 200,
      page: 1,
      per_page: 5,
    });

    expect(res.body).toMatchObject({ chat_id: chatId, page: 1, per_page: 5 });
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('combines file_name with pagination', async () => {
    const res = await authed(request(app).get(`/api/v1/videos/by/${chatId}`)).query({
      limit: 200,
      file_name: TEST_QUEUE_FILE_NAME,
      page: 1,
      per_page: 5,
    });

    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((entry: { file_name: string }) => entry.file_name === TEST_QUEUE_FILE_NAME)).toBe(true);
  });
});
