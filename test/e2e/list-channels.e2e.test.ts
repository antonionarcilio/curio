import { extractDigits } from '@/services/videos/filters';
import { client, ensureConnected } from '@/telegram-client';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { TARGETS } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() (não disconnect()) marca client._destroyed = true — sem isso o
// _updateLoop interno do GramJS continua acordando a cada 9s pra pingar um
// sender já desconectado, gerando "[Error: TIMEOUT]"/"Cannot log after tests
// are done" indefinidamente e travando o processo do Jest aberto no final.
afterAll(() => client.destroy());

const channelTargets = TARGETS.filter((target) => target.isChannel);

describe.each(channelTargets)('GET /api/v1/channels (e2e) — $label', ({ chatId }) => {
  it('finds the test channel with no query params', async () => {
    const res = await authed(request(app).get('/api/v1/channels')).query({ limit: 100 });

    expect(res.status).toBe(200);
    const channel = res.body.find(
      (entry: { channel_id: string }) => extractDigits(entry.channel_id) === extractDigits(chatId),
    );
    expect(channel).toBeDefined();
  });

  it('filters by channel_id', async () => {
    const res = await authed(request(app).get('/api/v1/channels')).query({ limit: 100, channel_id: chatId });

    expect(res.body.length).toBeGreaterThan(0);
    expect(
      res.body.every((entry: { channel_id: string }) => extractDigits(entry.channel_id) === extractDigits(chatId)),
    ).toBe(true);
  });

  it('filters by channel_title (discovered dynamically)', async () => {
    const unfiltered = await authed(request(app).get('/api/v1/channels')).query({ limit: 100, channel_id: chatId });
    const channelTitle = unfiltered.body[0].channel_title as string;

    const res = await authed(request(app).get('/api/v1/channels')).query({ limit: 100, channel_title: channelTitle });

    expect(
      res.body.some((entry: { channel_id: string }) => extractDigits(entry.channel_id) === extractDigits(chatId)),
    ).toBe(true);
  });

  it('returns a paginated envelope when page/per_page are given', async () => {
    const res = await authed(request(app).get('/api/v1/channels')).query({ limit: 100, page: 1, per_page: 5 });

    expect(res.body).toMatchObject({ page: 1, per_page: 5 });
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
