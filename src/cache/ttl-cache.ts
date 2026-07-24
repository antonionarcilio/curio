type CacheEntry<T> = { value: T; expiresAt: number };

export function createTtlCache<T>(ttlMs: number) {
  const store = new Map<string, CacheEntry<T>>();
  const pending = new Map<string, Promise<T>>();

  async function getOrSet(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = store.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const inFlight = pending.get(key);
    if (inFlight) return inFlight;

    const promise = fetcher()
      .then((value) => {
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      })
      .finally(() => pending.delete(key));

    pending.set(key, promise);
    return promise;
  }

  return { getOrSet };
}

// Aplica cache a uma função de leitura sem precisar reescrever o corpo dela
// com getOrSet manualmente — usar isso ao adicionar qualquer nova função de
// leitura em telegram-client.ts que deva se beneficiar de cache.
export function withCache<Args extends unknown[], T>(
  ttlMs: number,
  keyFn: (...args: Args) => string,
  fetcher: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  const cache = createTtlCache<T>(ttlMs);
  return (...args: Args) => cache.getOrSet(keyFn(...args), () => fetcher(...args));
}
