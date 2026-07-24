import { createSignedUrl, verifySignedUrl } from '../src/signed-url';

describe('signed-url', () => {
  const NOW = 1_700_000_000;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createSignedUrl', () => {
    it('produces a url of the expected shape with exp ~ now + 1h', () => {
      const url = createSignedUrl('http://localhost:8787', 'chat1', 42);
      const match = /^http:\/\/localhost:8787\/video\/chat1\/42\?exp=(\d+)&sig=([0-9a-f]+)$/.exec(url);
      expect(match).not.toBeNull();
      const exp = Number(match![1]);
      expect(exp).toBe(NOW + 3600);
    });
  });

  describe('verifySignedUrl', () => {
    function signedParams(chatId: string, messageId: string | number) {
      const url = createSignedUrl('http://x', chatId, messageId);
      const parsed = new URL(url);
      return {
        exp: parsed.searchParams.get('exp')!,
        sig: parsed.searchParams.get('sig')!,
      };
    }

    it('returns true for a freshly created signature', () => {
      const { exp, sig } = signedParams('chat1', 42);
      expect(verifySignedUrl('chat1', 42, exp, sig)).toBe(true);
    });

    it('returns false when exp is in the past', () => {
      const { exp, sig } = signedParams('chat1', 42);
      jest.setSystemTime((NOW + 3601) * 1000);
      expect(verifySignedUrl('chat1', 42, exp, sig)).toBe(false);
    });

    it('returns false for a tampered signature', () => {
      const { exp, sig } = signedParams('chat1', 42);
      const tampered = sig.slice(0, -1) + (sig.at(-1) === '0' ? '1' : '0');
      expect(verifySignedUrl('chat1', 42, exp, tampered)).toBe(false);
    });

    it('returns false for a tampered chatId', () => {
      const { exp, sig } = signedParams('chat1', 42);
      expect(verifySignedUrl('chat2', 42, exp, sig)).toBe(false);
    });

    it('returns false for a tampered messageId', () => {
      const { exp, sig } = signedParams('chat1', 42);
      expect(verifySignedUrl('chat1', 43, exp, sig)).toBe(false);
    });

    it('returns false for a tampered exp', () => {
      const { exp, sig } = signedParams('chat1', 42);
      expect(verifySignedUrl('chat1', 42, Number(exp) + 10, sig)).toBe(false);
    });

    it('returns false for a non-numeric exp', () => {
      const { sig } = signedParams('chat1', 42);
      expect(verifySignedUrl('chat1', 42, 'not-a-number', sig)).toBe(false);
    });

    it('returns false when sig has a different length than expected (no throw)', () => {
      const { exp } = signedParams('chat1', 42);
      expect(() => verifySignedUrl('chat1', 42, exp, 'short')).not.toThrow();
      expect(verifySignedUrl('chat1', 42, exp, 'short')).toBe(false);
    });
  });
});
