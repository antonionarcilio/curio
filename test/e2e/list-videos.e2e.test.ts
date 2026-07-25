import { clearAllCaches } from '@/cache/ttl-cache';
import { client, ensureConnected, listVideos } from '@/telegram-client';
import { removeFixture, TARGETS, uploadFixture } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
afterAll(() => client.disconnect());

describe.each(TARGETS)('listVideos (e2e) — $label', ({ chatId }) => {
  let messageId: number;

  beforeAll(async () => {
    messageId = await uploadFixture(chatId);
    clearAllCaches();
  });

  afterAll(async () => {
    await removeFixture(chatId, messageId);
  });

  it('sees the uploaded video in the listing', async () => {
    const { total } = await listVideos(chatId, { limit: 1, offset: 0 });
    expect(total).toBeGreaterThanOrEqual(1);
  });
});
