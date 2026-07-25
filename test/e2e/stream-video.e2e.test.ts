import { clearAllCaches } from '@/cache/ttl-cache';
import { client, ensureConnected, getVideoMessage } from '@/telegram-client';
import bigInt from 'big-integer';
import { ORIGINAL_DESCRIPTION, removeFixture, TARGETS, uploadFixture } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
afterAll(() => client.disconnect());

describe.each(TARGETS)('getVideoMessage + iterDownload (e2e) — $label', ({ chatId }) => {
  let messageId: number;

  beforeAll(async () => {
    messageId = await uploadFixture(chatId);
    clearAllCaches();
  });

  afterAll(async () => {
    await removeFixture(chatId, messageId);
  });

  it('resolves metadata and downloads real bytes via iterDownload', async () => {
    const video = await getVideoMessage(chatId, messageId);
    expect(video.mimeType).toMatch(/^video\//);
    expect(video.message.message).toBe(ORIGINAL_DESCRIPTION);

    // Guarda de regressão: offset/limit precisam ser big-integer, não BigInt
    // nativo — GramJS chama .divide()/.add() neles internamente.
    const chunks: Buffer[] = [];
    const iterator = client.iterDownload({
      file: video.message.media!,
      offset: bigInt(0),
      limit: 1024,
      requestSize: 1024,
    });
    for await (const chunk of iterator) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).length).toBeGreaterThan(0);
  });
});
