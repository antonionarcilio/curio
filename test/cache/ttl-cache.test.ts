import { clearAllCaches, createTtlCache, withCache } from '../../src/cache/ttl-cache';

describe('createTtlCache', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('caches the fetcher result for the same key within the TTL', async () => {
    const cache = createTtlCache<number>(1000);
    const fetcher = jest.fn().mockResolvedValue(42);

    expect(await cache.getOrSet('k', fetcher)).toBe(42);
    expect(await cache.getOrSet('k', fetcher)).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after the TTL expires', async () => {
    const cache = createTtlCache<number>(1000);
    const fetcher = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.getOrSet('k', fetcher)).toBe(1);
    jest.setSystemTime(1001);
    expect(await cache.getOrSet('k', fetcher)).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('de-dupes concurrent in-flight calls for the same key', async () => {
    const cache = createTtlCache<number>(1000);
    let resolveFetch!: (value: number) => void;
    const fetcher = jest.fn(() => new Promise<number>((resolve) => (resolveFetch = resolve)));

    const p1 = cache.getOrSet('k', fetcher);
    const p2 = cache.getOrSet('k', fetcher);
    resolveFetch(7);

    expect(await p1).toBe(7);
    expect(await p2).toBe(7);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keys are independent from each other', async () => {
    const cache = createTtlCache<number>(1000);
    const fetcher = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.getOrSet('a', fetcher)).toBe(1);
    expect(await cache.getOrSet('b', fetcher)).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('clear() forces the next call to re-fetch', async () => {
    const cache = createTtlCache<number>(1000);
    const fetcher = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.getOrSet('k', fetcher)).toBe(1);
    cache.clear();
    expect(await cache.getOrSet('k', fetcher)).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('withCache', () => {
  it('wraps a function, keying the cache via keyFn', async () => {
    const fetcher = jest.fn(async (a: string, b: number) => `${a}-${b}`);
    const wrapped = withCache(1000, (a: string, b: number) => `${a}:${b}`, fetcher);

    expect(await wrapped('x', 1)).toBe('x-1');
    expect(await wrapped('x', 1)).toBe('x-1');
    expect(await wrapped('x', 2)).toBe('x-2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('clearAllCaches', () => {
  it('clears every cache created via createTtlCache/withCache in the process', async () => {
    const cacheA = createTtlCache<number>(1000);
    const fetcherA = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const fetcherB = jest.fn(async () => 'b');
    const wrappedB = withCache(1000, () => 'k', fetcherB);

    expect(await cacheA.getOrSet('k', fetcherA)).toBe(1);
    expect(await wrappedB()).toBe('b');

    clearAllCaches();

    expect(await cacheA.getOrSet('k', fetcherA)).toBe(2);
    expect(fetcherA).toHaveBeenCalledTimes(2);
    await wrappedB();
    expect(fetcherB).toHaveBeenCalledTimes(2);
  });
});
