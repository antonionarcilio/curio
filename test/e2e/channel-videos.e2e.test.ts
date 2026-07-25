import { clearAllCaches } from '@/cache/ttl-cache';
import { client, ensureConnected, getChannelVideos, getVideoThumbnail } from '@/telegram-client';
import { removeFixture, TARGETS, uploadFixture } from './helpers/video-fixture';

// getChannelVideos é a função usada por GET /channels/:channelId/videos —
// distinta de listVideos (usada por GET /list/:chatId) — então só faz sentido
// exercitar aqui pra alvos que são de fato canais.
const channelTargets = TARGETS.filter((target) => target.isChannel);

beforeAll(() => ensureConnected());
afterAll(() => client.disconnect());

describe.each(channelTargets)('getChannelVideos (e2e) — $label', ({ chatId }) => {
  let messageId: number;

  beforeAll(async () => {
    messageId = await uploadFixture(chatId);
    clearAllCaches();
  });

  afterAll(async () => {
    await removeFixture(chatId, messageId);
  });

  it('sees the uploaded video in the channel-specific listing', async () => {
    const result = await getChannelVideos(chatId, { limit: 5, offset: 0 });
    expect(result.items.some((item) => item.message_id === messageId)).toBe(true);
  });

  // Metadados extraídos do Api.Document (DocumentAttributeVideo/thumbs) — o
  // único jeito de detectar drift de contrato do GramJS nesses campos, já que
  // os mocks das outras camadas passariam de qualquer forma. `thumbnail` em si
  // fica null aqui de propósito: os bytes só são baixados sob demanda via
  // getVideoThumbnail (ver teste abaixo), nunca automaticamente no fetch.
  it('carries the video metadata straight from the message, without downloading the thumbnail bytes', async () => {
    const { items } = await getChannelVideos(chatId, { limit: 5, offset: 0 });
    const uploaded = items.find((item) => item.message_id === messageId);

    expect(uploaded).toBeDefined();
    expect(uploaded?.duration).toBeGreaterThan(0);
    expect(uploaded?.width).toBeGreaterThan(0);
    expect(uploaded?.height).toBeGreaterThan(0);
    expect(uploaded?.thumbnail_width).toBeGreaterThan(0);
    expect(uploaded?.thumbnail).toBeNull();
  });

  it('downloads the real thumbnail bytes for the uploaded video', async () => {
    const thumbnail = await getVideoThumbnail(chatId, messageId);

    expect(thumbnail.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(thumbnail.thumbnail.length).toBeGreaterThan(1000);
    expect(thumbnail.thumbnail_width).toBeGreaterThan(0);
  });
});
