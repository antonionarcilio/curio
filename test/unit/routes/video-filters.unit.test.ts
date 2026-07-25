import { extractDigits, filterByFileName, filterVideos } from '@/routes/video-filters';
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
    ...overrides,
  };
}

describe('extractDigits', () => {
  it('strips non-digit characters, making the "-" sign irrelevant', () => {
    expect(extractDigits('-1001234567890')).toBe('1001234567890');
    expect(extractDigits('1001234567890')).toBe('1001234567890');
  });
});

describe('filterVideos', () => {
  it('matches chatId ignoring the sign', () => {
    const videos = [makeVideo({ chat_id: '-1001234567890' })];
    expect(filterVideos(videos, { chatId: '1001234567890' })).toHaveLength(1);
    expect(filterVideos(videos, { chatId: '-1001234567890' })).toHaveLength(1);
    expect(filterVideos(videos, { chatId: '999' })).toHaveLength(0);
  });

  it('matches chatTitle case/accent-insensitively', () => {
    const videos = [makeVideo({ chat_title: 'Séries Favoritas' })];
    expect(filterVideos(videos, { chatTitle: 'series' })).toHaveLength(1);
    expect(filterVideos(videos, { chatTitle: 'nada' })).toHaveLength(0);
  });

  it('matches fileName case/accent-insensitively', () => {
    const videos = [makeVideo({ file_name: 'Relatório Final.mp4' })];
    expect(filterVideos(videos, { fileName: 'relatorio' })).toHaveLength(1);
    expect(filterVideos(videos, { fileName: 'nada' })).toHaveLength(0);
  });

  it('requires all provided filters to match (AND semantics)', () => {
    const videos = [makeVideo({ chat_id: '1', file_name: 'a.mp4' }), makeVideo({ chat_id: '1', file_name: 'b.mp4' })];
    expect(filterVideos(videos, { chatId: '1', fileName: 'a' })).toHaveLength(1);
  });

  it('returns all videos when no filters are given', () => {
    const videos = [makeVideo(), makeVideo()];
    expect(filterVideos(videos, {})).toHaveLength(2);
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
