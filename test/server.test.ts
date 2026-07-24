import request from 'supertest';
import { createSignedUrl } from '../src/signed-url';

jest.mock('../src/telegram-client', () => ({
  client: { iterDownload: jest.fn() },
  ensureConnected: jest.fn().mockResolvedValue(undefined),
  getVideoMessage: jest.fn().mockRejectedValue(new Error('not used in these tests')),
  listAllVideos: jest.fn().mockResolvedValue([]),
  listChannels: jest.fn().mockResolvedValue([]),
  getChannelVideos: jest.fn().mockResolvedValue({ channel_id: 'x', channel_title: 'x', items: [], total: 0 }),
  listVideos: jest.fn().mockResolvedValue({ items: [], total: 0 }),
}));

import type { Request } from 'express';
import { buildApp, extractBearerToken, timingSafeEqualStrings, verifySignedStream } from '../src/server';

const ACCESS_TOKEN = process.env.ACCESS_TOKEN as string;

describe('timingSafeEqualStrings', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqualStrings('secret', 'secret')).toBe(true);
  });

  it('returns false for different-length strings without throwing', () => {
    expect(() => timingSafeEqualStrings('short', 'a-much-longer-string')).not.toThrow();
    expect(timingSafeEqualStrings('short', 'a-much-longer-string')).toBe(false);
  });

  it('returns false for same-length but different content', () => {
    expect(timingSafeEqualStrings('aaaaa', 'bbbbb')).toBe(false);
  });
});

describe('extractBearerToken', () => {
  function req(authorization?: string): Request {
    return { headers: { authorization } } as unknown as Request;
  }

  it('extracts the token from a well-formed Bearer header', () => {
    expect(extractBearerToken(req('Bearer abc123'))).toBe('abc123');
  });

  it('returns "" when the header is missing', () => {
    expect(extractBearerToken(req(undefined))).toBe('');
  });

  it('returns "" for a malformed scheme', () => {
    expect(extractBearerToken(req('Basic xyz'))).toBe('');
  });
});

describe('verifySignedStream', () => {
  function req(path: string, query: Record<string, string>): Request {
    return { path, query } as unknown as Request;
  }

  it('rejects paths outside the streaming route even with a valid signature', () => {
    const url = createSignedUrl('http://x', 'chat1', 1);
    const { searchParams } = new URL(url);
    const fakeReq = req('/videos', { exp: searchParams.get('exp')!, sig: searchParams.get('sig')! });
    expect(verifySignedStream(fakeReq)).toBe(false);
  });

  it('rejects a valid-looking signature scoped to a different chatId/messageId', () => {
    const url = createSignedUrl('http://x', 'chat1', 1);
    const { searchParams } = new URL(url);
    const fakeReq = req('/video/chat2/1', { exp: searchParams.get('exp')!, sig: searchParams.get('sig')! });
    expect(verifySignedStream(fakeReq)).toBe(false);
  });

  it('accepts a valid signature scoped to the matching chatId/messageId', () => {
    const url = createSignedUrl('http://x', 'chat1', 1);
    const { searchParams } = new URL(url);
    const fakeReq = req('/video/chat1/1', { exp: searchParams.get('exp')!, sig: searchParams.get('sig')! });
    expect(verifySignedStream(fakeReq)).toBe(true);
  });

  it('rejects when exp or sig query params are missing', () => {
    expect(verifySignedStream(req('/video/chat1/1', {}))).toBe(false);
  });
});

describe('requireToken (HTTP integration via buildApp)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('returns 401 without an Authorization header in strict mode', async () => {
    const res = await request(buildApp()).get('/videos');
    expect(res.status).toBe(401);
  });

  it('passes through with the correct Bearer token', async () => {
    const res = await request(buildApp()).get('/videos').set('Authorization', `Bearer ${ACCESS_TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('returns 401 with an incorrect Bearer token', async () => {
    const res = await request(buildApp()).get('/videos').set('Authorization', 'Bearer wrong-token');
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
      .get('/videos')
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
    const devServer = require('../src/server') as typeof import('../src/server');
    const res = await request(devServer.buildApp()).get('/videos');
    expect(res.status).toBe(200);
  });

  it.each(['', 'production', 'Development'])('stays strict (401) for NODE_ENV=%p', async (value) => {
    jest.resetModules();
    process.env.NODE_ENV = value;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the new NODE_ENV
    const strictServer = require('../src/server') as typeof import('../src/server');
    const res = await request(strictServer.buildApp()).get('/videos');
    expect(res.status).toBe(401);
  });
});
