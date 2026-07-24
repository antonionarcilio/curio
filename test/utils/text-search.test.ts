import { includesSearchTerm, normalizeForSearch } from '../../src/utils/text-search';

describe('normalizeForSearch', () => {
  it('lowercases, strips diacritics, and trims', () => {
    expect(normalizeForSearch('  São Paulo  ')).toBe('sao paulo');
  });
});

describe('includesSearchTerm', () => {
  it('matches regardless of accents and case', () => {
    expect(includesSearchTerm('Vídeo Incrível', 'video')).toBe(true);
    expect(includesSearchTerm('Vídeo Incrível', 'INCRIVEL')).toBe(true);
  });

  it('returns false when the term is not present', () => {
    expect(includesSearchTerm('Vídeo Incrível', 'nada aqui')).toBe(false);
  });

  it('matches a substring, not just whole words', () => {
    expect(includesSearchTerm('minha_serie_final.mp4', 'serie')).toBe(true);
  });
});
