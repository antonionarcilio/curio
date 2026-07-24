import { buildContentDisposition, parseRange } from '../../src/routes/http-utils';

describe('parseRange', () => {
  const size = 1000;

  it('returns null when there is no Range header', () => {
    expect(parseRange(undefined, size)).toBeNull();
  });

  it('parses a closed range', () => {
    expect(parseRange('bytes=0-499', size)).toEqual({ start: 0, end: 499 });
  });

  it('parses an open-ended range (end defaults to size - 1)', () => {
    expect(parseRange('bytes=500-', size)).toEqual({ start: 500, end: 999 });
  });

  it('does not implement suffix-range: "bytes=-500" is parsed as start=0, end=500 (known quirk)', () => {
    // A spec-compliant server would interpret "bytes=-500" as "last 500 bytes".
    // The current implementation's fallback (`startStr ? ... : 0`) instead
    // treats the missing start as 0 and reads "500" as the end, so this
    // documents the *actual* current behavior rather than the spec-correct one.
    expect(parseRange('bytes=-500', size)).toEqual({ start: 0, end: 500 });
  });

  it('returns null for a malformed header without "bytes=" prefix', () => {
    expect(parseRange('0-499', size)).toBeNull();
  });

  it('returns null for non-numeric range values', () => {
    expect(parseRange('bytes=abc-def', size)).toBeNull();
  });

  it('returns null when start > end', () => {
    expect(parseRange('bytes=500-100', size)).toBeNull();
  });

  it('returns null when end >= size', () => {
    expect(parseRange('bytes=0-1000', size)).toBeNull();
  });
});

describe('buildContentDisposition', () => {
  it('produces identical filename= and filename*= for ASCII names', () => {
    const header = buildContentDisposition('inline', 'video.mp4');
    expect(header).toBe(`inline; filename="video.mp4"; filename*=UTF-8''video.mp4`);
  });

  it('ASCII-sanitizes filename= while percent-encoding filename*= for non-ASCII names', () => {
    const header = buildContentDisposition('inline', '日本語.mp4');
    expect(header).toBe(`inline; filename="___.mp4"; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.mp4`);
  });

  it('sanitizes quote/CR/LF characters embedded in the name (header-injection guard)', () => {
    const header = buildContentDisposition('attachment', 'evil"\r\nX-Injected: 1.mp4');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="evil___X-Injected: 1.mp4"');
    expect(header).not.toContain('evil"\r\nX-Injected');
  });
});
