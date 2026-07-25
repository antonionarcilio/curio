import router from '@/routes/index';
import { mountRouter } from '@test/helpers/mount-router';
import request from 'supertest';

const buildApp = () => mountRouter(router);

describe('GET /routes', () => {
  it('recursively lists every route registered across the mounted sub-routers', async () => {
    const res = await request(buildApp()).get('/routes');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: '/videos' },
        { method: 'GET', path: '/channels' },
        { method: 'GET', path: '/channels/:channelId/videos' },
        { method: 'GET', path: '/list/:chatId' },
        { method: 'POST', path: '/cache/purge' },
        { method: 'GET', path: '/video/:chatId/:messageId' },
        { method: 'GET', path: '/routes' },
      ]),
    );
  });
});
