import request from 'supertest';

const mockListAudios = jest.fn();
const mockGetAudioThumbnail = jest.fn();

jest.mock('@/telegram-client', () => ({
  listAudios: mockListAudios,
  getAudioThumbnail: mockGetAudioThumbnail,
}));

import audiosByRouter from '@/routes/audios/by/route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter(audiosByRouter);

const item = (message_id: number, file_name: string, description: string | null = null) => ({
  message_id,
  file_name,
  size: 100,
  mime_type: 'audio/mpeg',
  date: 1700000000,
  description,
  duration: 180,
  title: 'Song Title',
  performer: 'The Artist',
  thumbnail_width: 320,
  thumbnail_height: 320,
  thumbnail: null,
});

describe('GET /audios/by/:chatId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses native pagination via listAudios when there is no file_name filter', async () => {
    mockListAudios.mockResolvedValue({ items: [item(1, 'a.mp3')], total: 1 });

    const res = await request(buildApp()).get('/audios/by/chat1');

    expect(res.status).toBe(200);
    expect(res.body.chat_id).toBe('chat1');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].url).toMatch(/^http:\/\/.+\/api\/v1\/audio\/stream\/chat1\/1\?exp=\d+&sig=[0-9a-f]+$/);
    expect(mockListAudios).toHaveBeenCalledWith('chat1', { limit: 100, offset: 0 });
  });

  it('fetches the full set and filters/paginates in-memory when file_name is present', async () => {
    mockListAudios.mockResolvedValue({ items: [item(1, 'aula-01.mp3'), item(2, 'aula-02.mp3')], total: 2 });

    const res = await request(buildApp()).get('/audios/by/chat1').query({ file_name: 'aula-01' });

    expect(mockListAudios).toHaveBeenCalledWith('chat1', { limit: 100, offset: 0 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].message_id).toBe(1);
  });

  it('fetches, filters by file_name, then paginates in-memory when file_name and page/per_page are both given', async () => {
    mockListAudios.mockResolvedValue({
      items: [item(1, 'aula-01.mp3'), item(2, 'aula-02.mp3'), item(3, 'aula-03.mp3')],
      total: 3,
    });

    const res = await request(buildApp()).get('/audios/by/chat1').query({ file_name: 'aula', page: 2, per_page: 1 });

    expect(mockListAudios).toHaveBeenCalledWith('chat1', { limit: 100, offset: 0 });
    expect(res.body).toMatchObject({ chat_id: 'chat1', page: 2, per_page: 1, total: 3, total_pages: 3 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].message_id).toBe(2);
  });

  it('returns a paginated envelope with native pagination when page/per_page are given (no file_name)', async () => {
    mockListAudios.mockResolvedValue({ items: [item(3, 'c.mp3')], total: 5 });

    const res = await request(buildApp()).get('/audios/by/chat1').query({ page: 2, per_page: 1 });

    expect(mockListAudios).toHaveBeenCalledWith('chat1', { limit: 1, offset: 1 });
    expect(res.body).toMatchObject({ chat_id: 'chat1', page: 2, per_page: 1, total: 5, total_pages: 5 });
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 400 for an invalid query', async () => {
    const res = await request(buildApp()).get('/audios/by/chat1').query({ per_page: 1000 });
    expect(res.status).toBe(400);
  });

  describe('thumbnail query param', () => {
    beforeEach(() => {
      mockListAudios.mockResolvedValue({ items: [item(1, 'a.mp3'), item(2, 'b.mp3')], total: 2 });
    });

    it('returns the audio metadata with thumbnail: null by default, without downloading anything', async () => {
      const res = await request(buildApp()).get('/audios/by/chat1');

      expect(res.body.data[0]).toMatchObject({
        duration: 180,
        title: 'Song Title',
        performer: 'The Artist',
        thumbnail_width: 320,
        thumbnail_height: 320,
        thumbnail: null,
      });
      expect(mockGetAudioThumbnail).not.toHaveBeenCalled();
    });

    it('downloads a real thumbnail (e.g. album art) per item when thumbnail=true', async () => {
      mockGetAudioThumbnail.mockImplementation(async (_chatId: string, messageId: number) => ({
        thumbnail: `data:image/jpeg;base64,full-${messageId}`,
        thumbnail_width: 320,
        thumbnail_height: 320,
      }));

      const res = await request(buildApp()).get('/audios/by/chat1').query({ thumbnail: 'true' });

      expect(mockGetAudioThumbnail).toHaveBeenCalledTimes(2);
      expect(mockGetAudioThumbnail).toHaveBeenCalledWith('chat1', 1);
      expect(res.body.data[0]).toMatchObject({ thumbnail: 'data:image/jpeg;base64,full-1' });
    });

    it('keeps thumbnail: null for the item whose download fails, without failing the request', async () => {
      mockGetAudioThumbnail.mockRejectedValueOnce(new Error('flood wait'));
      mockGetAudioThumbnail.mockResolvedValueOnce({
        thumbnail: 'data:image/jpeg;base64,full-2',
        thumbnail_width: 320,
        thumbnail_height: 320,
      });

      const res = await request(buildApp()).get('/audios/by/chat1').query({ thumbnail: 'true' });

      expect(res.status).toBe(200);
      expect(res.body.data[0].thumbnail).toBeNull();
      expect(res.body.data[1].thumbnail).toBe('data:image/jpeg;base64,full-2');
    });

    it('returns 400 for an invalid thumbnail value', async () => {
      const res = await request(buildApp()).get('/audios/by/chat1').query({ thumbnail: 'huge' });
      expect(res.status).toBe(400);
    });
  });

  it('returns 500 with the error message when listAudios rejects', async () => {
    mockListAudios.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/audios/by/chat1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
