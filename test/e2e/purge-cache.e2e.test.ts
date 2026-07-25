import { client, ensureConnected } from '@/telegram-client';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { readFixtureState } from './helpers/shared-state';
import { TARGETS } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() (não disconnect()) marca client._destroyed = true — sem isso o
// _updateLoop interno do GramJS continua acordando a cada 9s pra pingar um
// sender já desconectado, gerando "[Error: TIMEOUT]"/"Cannot log after tests
// are done" indefinidamente e travando o processo do Jest aberto no final.
afterAll(() => client.destroy());

const channelTarget = TARGETS.find((target) => target.isChannel);
if (!channelTarget) throw new Error('TARGETS precisa incluir um alvo de canal');
const { chatId } = channelTarget;

describe('POST /api/v1/cache/purge (e2e)', () => {
  it('clears the cache and a subsequent read still finds the fixture', async () => {
    const fixture = readFixtureState(chatId);
    if (!fixture) throw new Error(`Fixture ausente para "${chatId}" — upload-video.e2e.test.ts precisa rodar antes`);

    const before = await authed(request(app).get(`/api/v1/videos/by/${chatId}`)).query({ limit: 200 });
    expect(before.body.data.some((entry: { message_id: number }) => entry.message_id === fixture.messageId)).toBe(true);

    const purgeRes = await authed(request(app).post('/api/v1/cache/purge'));
    expect(purgeRes.status).toBe(200);
    expect(purgeRes.body).toEqual({ purged: true });

    const after = await authed(request(app).get(`/api/v1/videos/by/${chatId}`)).query({ limit: 200 });
    expect(after.body.data.some((entry: { message_id: number }) => entry.message_id === fixture.messageId)).toBe(true);
  });
});
