import { extractBearerToken, timingSafeEqualStrings, verifySignedStream } from '@/server';
import { createSignedUrl } from '@/signed-url';
import type { Request } from 'express';

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
