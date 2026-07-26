import { extractDigits } from '@/services/videos/filters';
import { client, ensureConnected } from '@/telegram-client';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { TARGETS } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

const channelTargets = TARGETS.filter((target) => target.isChannel);

describe.each(channelTargets)('GET /api/v1/channel/:channel_id (e2e) — $label', ({ chatId }) => {
  it('returns the basic channel details', async () => {
    const res = await authed(request(app).get(`/api/v1/channel/${chatId}`));

    expect(res.status).toBe(200);
    expect(extractDigits(res.body.channel_id)).toBe(extractDigits(chatId));
    expect(res.body).toMatchObject({
      channel_title: expect.any(String),
      type: expect.stringMatching(/^(channel|supergroup)$/),
    });
    expect(res.body).toHaveProperty('description');
    expect(res.body).toHaveProperty('username');
    expect(res.body).toHaveProperty('participants_count');
    expect(res.body).toHaveProperty('admins_count');
    expect(res.body).toHaveProperty('kicked_count');
    expect(res.body).toHaveProperty('banned_count');
    expect(res.body).toHaveProperty('online_count');
  });
});
