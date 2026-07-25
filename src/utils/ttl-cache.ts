type CacheEntry<T> = { value: T; expiresAt: number };

// Todo cache criado por createTtlCache se registra aqui, pra que
// clearAllCaches() consiga zerar todos eles sem cada chamador precisar
// guardar/expor sua própria referência.
const registry: { clear: () => void }[] = [];

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

  function clear(): void {
    store.clear();
    pending.clear();
  }

  const cache = { getOrSet, clear };
  registry.push(cache);
  return cache;
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

// Zera todo cache criado no processo (via createTtlCache/withCache), inclusive
// requisições em andamento — a próxima chamada busca dados frescos no Telegram.
export function clearAllCaches(): void {
  registry.forEach((cache) => cache.clear());
}
