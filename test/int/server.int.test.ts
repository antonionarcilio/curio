import { createSignedUrl } from '@/signed-url';
import request from 'supertest';

const mockGetMyProfile = jest.fn();

jest.mock('@/telegram-client', () => ({
  client: { _media: { getFile: jest.fn() } },
  ensureConnected: jest.fn().mockResolvedValue(undefined),
  getVideoMessage: jest.fn().mockRejectedValue(new Error('not used in these tests')),
  listAllVideos: jest.fn().mockResolvedValue([]),
  listChannels: jest.fn().mockResolvedValue([]),
  getChannelInfo: jest.fn().mockResolvedValue({
    channel_id: '-1001',
    channel_title: 'Channel',
    description: null,
    username: null,
    type: 'channel',
    participants_count: null,
    admins_count: null,
    kicked_count: null,
    banned_count: null,
    online_count: null,
  }),
  getMyProfile: mockGetMyProfile,
  listVideos: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  editVideoCaption: jest.fn().mockResolvedValue(undefined),
}));

import { buildApp } from '@/server';

const ACCESS_TOKEN = process.env.ACCESS_TOKEN as string;

describe('requireToken (HTTP integration via buildApp)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('returns 401 without an Authorization header in strict mode', async () => {
    const res = await request(buildApp()).get('/api/v1/videos/grouped');
    expect(res.status).toBe(401);
  });

  it('passes through with the correct Bearer token', async () => {
    const res = await request(buildApp()).get('/api/v1/videos/grouped').set('Authorization', `Bearer ${ACCESS_TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('protects GET /me with the global Bearer-token middleware', async () => {
    mockGetMyProfile.mockResolvedValue({
      id: '123456789',
      first_name: 'Ana',
      last_name: null,
      username: 'ana',
      premium: false,
    });

    const unauthenticated = await request(buildApp()).get('/api/v1/me');
    expect(unauthenticated.status).toBe(401);

    const authenticated = await request(buildApp()).get('/api/v1/me').set('Authorization', `Bearer ${ACCESS_TOKEN}`);
    expect(authenticated.status).toBe(200);
    expect(authenticated.body).toEqual({
      id: '123456789',
      first_name: 'Ana',
      last_name: null,
      username: 'ana',
      premium: false,
    });
  });

  it('returns 401 with an incorrect Bearer token', async () => {
    const res = await request(buildApp()).get('/api/v1/videos/grouped').set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  it('lets a valid signed URL through on the streaming route without an Authorization header', async () => {
    const url = createSignedUrl('http://x', 'chat1', 1);
    const { pathname, searchParams } = new URL(url);
    const res = await request(buildApp())
      .get(pathname)
      .query({
        exp: searchParams.get('exp')!,
        sig: searchParams.get('sig')!,
      });
    // getVideoMessage is mocked to reject, so a 404 (not 401) proves requireToken let it through.
    expect(res.status).toBe(404);
  });

  it('rejects the same signed query params reused against a discovery route', async () => {
    const url = createSignedUrl('http://x', 'chat1', 1);
    const { searchParams } = new URL(url);
    const res = await request(buildApp())
      .get('/api/v1/videos/grouped')
      .query({
        exp: searchParams.get('exp')!,
        sig: searchParams.get('sig')!,
      });
    expect(res.status).toBe(401);
  });

  it('rejects expired signed query params on the streaming route', async () => {
    jest.useFakeTimers().setSystemTime(0);
    const url = createSignedUrl('http://x', 'chat1', 1);
    const { pathname, searchParams } = new URL(url);
    jest.setSystemTime(3600 * 1000 + 1000);
    const res = await request(buildApp())
      .get(pathname)
      .query({ exp: searchParams.get('exp')!, sig: searchParams.get('sig')! });
    expect(res.status).toBe(401);
    jest.useRealTimers();
  });
});

describe('JSON body parsing (HTTP integration via buildApp)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('parses a JSON body on PATCH /api/v1/video/update/:chatId/:messageId instead of treating it as undefined', async () => {
    const res = await request(buildApp())
      .patch('/api/v1/video/update/chat1/10')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`)
      .send({ description: 'nova descrição' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ edited: true, chat_id: 'chat1', message_id: '10' });
  });
});

describe('requireToken dev auto-fill (fail-closed by design)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  it('auto-injects the master token when NODE_ENV=development and no header is sent', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'development';
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the new NODE_ENV
    const devServer = require('@/server') as typeof import('@/server');
    const res = await request(devServer.buildApp()).get('/api/v1/videos/grouped');
    expect(res.status).toBe(200);
  });

  it.each(['', 'production', 'Development'])('stays strict (401) for NODE_ENV=%p', async (value) => {
    jest.resetModules();
    process.env.NODE_ENV = value;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the new NODE_ENV
    const strictServer = require('@/server') as typeof import('@/server');
    const res = await request(strictServer.buildApp()).get('/api/v1/videos/grouped');
    expect(res.status).toBe(401);
  });
});

// `app.listen(port, callback)`'s callback fires as a 'listening' listener, but
// under the test harness's real timers it can lag noticeably behind the point
// where `httpServer.listening` first reads true — polling avoids relying on
// that ordering.
async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('startServer', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  it('connects, listens, and logs the dev hint when NODE_ENV=development', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'development';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the new NODE_ENV
    const devServer = require('@/server') as typeof import('@/server');
    const httpServer = await devServer.startServer();
    await waitUntil(() => logSpy.mock.calls.length >= 3);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('api-tg-cdn rodando em'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Modo dev'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Exemplo: curl'));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    logSpy.mockRestore();
  });

  it('omits the dev hint when NODE_ENV is not development', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the new NODE_ENV
    const strictServer = require('@/server') as typeof import('@/server');
    const httpServer = await strictServer.startServer();
    await waitUntil(() => logSpy.mock.calls.length >= 2);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Modo dev'));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    logSpy.mockRestore();
  });
});
