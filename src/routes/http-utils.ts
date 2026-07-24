export const CHUNK_SIZE = 512 * 1024;
export const SAFE_MIME_TYPE = /^video\/[a-z0-9.+-]+$/i;

// HTTP headers só aceitam Latin-1, então nomes de arquivo com caracteres fora
// desse range (CJK, emoji, etc.) precisam de um fallback ASCII em `filename=`
// e do valor real, percent-encoded, em `filename*=` (RFC 5987/6266).
export function buildContentDisposition(disposition: string, name: string): string {
  const cleaned = String(name).replace(/[\r\n"]/g, '_');
  const asciiFallback = cleaned.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(cleaned);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export type Range = { start: number; end: number };

export function parseRange(rangeHeader: string | undefined, size: number): Range | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match) return null;

  const [, startStr, endStr] = match;
  const start = startStr ? parseInt(startStr, 10) : 0;
  const end = endStr ? parseInt(endStr, 10) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
    return null;
  }

  return { start, end };
}
