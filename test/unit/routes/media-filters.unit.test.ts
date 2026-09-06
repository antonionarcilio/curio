import { extractDigits, filterByFileName, filterByMediaText, filterMediaItems } from '@/services/media-filters';
import type { VideoListEntry } from '@/telegram-client';

function makeVideo(overrides: Partial<VideoListEntry> = {}): VideoListEntry {
  return {
    chat_id: '-1001234567890',
    chat_title: 'My Channel',
    message_id: 1,
    file_name: 'video.mp4',
    size: 100,
    mime_type: 'video/mp4',
    date: 1700000000,
    description: null,
    ...overrides,
  };
}

describe('extractDigits', () => {
  it('strips non-digit characters, making the "-" sign irrelevant', () => {
    expect(extractDigits('-1001234567890')).toBe('1001234567890');
    expect(extractDigits('1001234567890')).toBe('1001234567890');
  });
});

describe('filterMediaItems', () => {
  it('matches chatId ignoring the sign', () => {
    const videos = [makeVideo({ chat_id: '-1001234567890' })];
    expect(filterMediaItems(videos, { chatId: '1001234567890' })).toHaveLength(1);
    expect(filterMediaItems(videos, { chatId: '-1001234567890' })).toHaveLength(1);
    expect(filterMediaItems(videos, { chatId: '999' })).toHaveLength(0);
  });

  it('matches chatTitle case/accent-insensitively', () => {
    const videos = [makeVideo({ chat_title: 'Séries Favoritas' })];
    expect(filterMediaItems(videos, { chatTitle: 'series' })).toHaveLength(1);
    expect(filterMediaItems(videos, { chatTitle: 'nada' })).toHaveLength(0);
  });

  it('matches fileName case/accent-insensitively', () => {
    const videos = [makeVideo({ file_name: 'Relatório Final.mp4' })];
    expect(filterMediaItems(videos, { fileName: 'relatorio' })).toHaveLength(1);
    expect(filterMediaItems(videos, { fileName: 'nada' })).toHaveLength(0);
  });

  it('matches description case/accent-insensitively', () => {
    const videos = [makeVideo({ description: 'Cena da #JavaScript em ação' }), makeVideo({ description: null })];
    expect(filterMediaItems(videos, { description: '#javascript' })).toHaveLength(1);
    expect(filterMediaItems(videos, { description: 'java' })).toHaveLength(1);
    expect(filterMediaItems(videos, { description: 'acao' })).toHaveLength(1);
  });

  it('requires all provided filters to match (AND semantics)', () => {
    const videos = [
      makeVideo({ chat_id: '1', file_name: 'a.mp4', description: '#JavaScript' }),
      makeVideo({ chat_id: '1', file_name: 'b.mp4', description: '#JavaScript' }),
    ];
    expect(filterMediaItems(videos, { chatId: '1', fileName: 'a', description: '#javascript' })).toHaveLength(1);
  });

  it('returns all videos when no filters are given', () => {
    const videos = [makeVideo(), makeVideo()];
    expect(filterMediaItems(videos, {})).toHaveLength(2);
  });
});

describe('filterByFileName', () => {
  const items = [{ file_name: 'Aula 01.mp4' }, { file_name: 'Aula 02.mp4' }];

  it('returns all items unchanged when fileName is not provided', () => {
    expect(filterByFileName(items)).toEqual(items);
  });

  it('filters case/accent-insensitively by file_name', () => {
    expect(filterByFileName(items, 'aula 01')).toEqual([items[0]]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterByFileName(items, 'nao existe')).toEqual([]);
  });
});

describe('filterByMediaText', () => {
  const items = [
    { file_name: 'Aula 01.mp4', description: '#JavaScript primeira parte' },
    { file_name: 'Aula 02.mp4', description: null },
  ];

  it('filters by description', () => {
    expect(filterByMediaText(items, { description: '#javascript' })).toEqual([items[0]]);
  });

  it('requires file_name and description to match when both are provided', () => {
    expect(filterByMediaText(items, { fileName: 'aula', description: '#javascript' })).toEqual([items[0]]);
    expect(filterByMediaText(items, { fileName: '02', description: '#javascript' })).toEqual([]);
  });
});
