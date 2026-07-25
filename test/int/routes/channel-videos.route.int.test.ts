import request from 'supertest';

const mockGetChannelVideos = jest.fn();
const mockGetVideoThumbnail = jest.fn();

jest.mock('@/telegram-client', () => ({
  getChannelVideos: mockGetChannelVideos,
  getVideoThumbnail: mockGetVideoThumbnail,
}));

import channelVideosRouter from '@/routes/channel-videos.route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter(channelVideosRouter);

const item = (message_id: number, file_name: string) => ({
  message_id,
  file_name,
  size: 100,
  mime_type: 'video/mp4',
  date: 1700000000,
  description: null,
  duration: 12,
  width: 1920,
  height: 1080,
  supports_streaming: true,
  thumbnail_width: 1280,
  thumbnail_height: 720,
  thumbnail: null,
});

describe('GET /channels/:channelId/videos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses native pagination via getChannelVideos when there is no file_name filter', async () => {
    mockGetChannelVideos.mockResolvedValue({
      channel_id: 'chat1',
      channel_title: 'My Channel',
      items: [item(1, 'a.mp4')],
      total: 1,
    });

    const res = await request(buildApp()).get('/channels/chat1/videos');

    expect(res.status).toBe(200);
    expect(res.body.channel_id).toBe('chat1');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].url).toMatch(/^http:\/\/.+\/video\/chat1\/1\?exp=\d+&sig=[0-9a-f]+$/);
    expect(mockGetChannelVideos).toHaveBeenCalledWith('chat1', { limit: 100, offset: 0 });
  });

  it('fetches the full set and filters/paginates in-memory when file_name is present', async () => {
    mockGetChannelVideos.mockResolvedValue({
      channel_id: 'chat1',
      channel_title: 'My Channel',
      items: [item(1, 'aula-01.mp4'), item(2, 'aula-02.mp4')],
      total: 2,
    });

    const res = await request(buildApp()).get('/channels/chat1/videos').query({ file_name: 'aula-01' });

    expect(mockGetChannelVideos).toHaveBeenCalledWith('chat1', { limit: 100, offset: 0 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].message_id).toBe(1);
  });

  it('fetches, filters by file_name, then paginates in-memory when file_name and page/per_page are both given', async () => {
    mockGetChannelVideos.mockResolvedValue({
      channel_id: 'chat1',
      channel_title: 'My Channel',
      items: [item(1, 'aula-01.mp4'), item(2, 'aula-02.mp4'), item(3, 'aula-03.mp4')],
      total: 3,
    });

    const res = await request(buildApp())
      .get('/channels/chat1/videos')
      .query({ file_name: 'aula', page: 2, per_page: 1 });

    expect(mockGetChannelVideos).toHaveBeenCalledWith('chat1', { limit: 100, offset: 0 });
    expect(res.body).toMatchObject({ channel_id: 'chat1', page: 2, per_page: 1, total: 3, total_pages: 3 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].message_id).toBe(2);
  });

  it('returns a paginated envelope with native pagination when page/per_page are given (no file_name)', async () => {
    mockGetChannelVideos.mockResolvedValue({
      channel_id: 'chat1',
      channel_title: 'My Channel',
      items: [item(3, 'c.mp4')],
      total: 5,
    });

    const res = await request(buildApp()).get('/channels/chat1/videos').query({ page: 2, per_page: 1 });

    expect(mockGetChannelVideos).toHaveBeenCalledWith('chat1', { limit: 1, offset: 1 });
    expect(res.body).toMatchObject({ channel_id: 'chat1', page: 2, per_page: 1, total: 5, total_pages: 5 });
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 400 for an invalid query', async () => {
    const res = await request(buildApp()).get('/channels/chat1/videos').query({ per_page: 1000 });
    expect(res.status).toBe(400);
  });

  describe('thumbnail query param', () => {
    beforeEach(() => {
      mockGetChannelVideos.mockResolvedValue({
        channel_id: 'chat1',
        channel_title: 'My Channel',
        items: [item(1, 'a.mp4'), item(2, 'b.mp4')],
        total: 2,
      });
    });

    it('returns the video metadata with thumbnail: null by default, without downloading anything', async () => {
      const res = await request(buildApp()).get('/channels/chat1/videos');

      expect(res.body.data[0]).toMatchObject({
        duration: 12,
        width: 1920,
        height: 1080,
        supports_streaming: true,
        thumbnail_width: 1280,
        thumbnail_height: 720,
        thumbnail: null,
      });
      expect(mockGetVideoThumbnail).not.toHaveBeenCalled();
    });

    it('stays null when thumbnail=false is passed explicitly', async () => {
      const res = await request(buildApp()).get('/channels/chat1/videos').query({ thumbnail: 'false' });

      expect(res.body.data[0].thumbnail).toBeNull();
      expect(mockGetVideoThumbnail).not.toHaveBeenCalled();
    });

    it('downloads a real thumbnail per item when thumbnail=true', async () => {
      mockGetVideoThumbnail.mockImplementation(async (_chatId: string, messageId: number) => ({
        thumbnail: `data:image/jpeg;base64,full-${messageId}`,
        thumbnail_width: 320,
        thumbnail_height: 180,
      }));

      const res = await request(buildApp()).get('/channels/chat1/videos').query({ thumbnail: 'true' });

      expect(mockGetVideoThumbnail).toHaveBeenCalledTimes(2);
      expect(mockGetVideoThumbnail).toHaveBeenCalledWith('chat1', 1);
      expect(res.body.data[0]).toMatchObject({
        thumbnail: 'data:image/jpeg;base64,full-1',
        thumbnail_width: 320,
        thumbnail_height: 180,
      });
    });

    it('keeps thumbnail: null for the item whose download fails, without failing the request', async () => {
      mockGetVideoThumbnail.mockRejectedValueOnce(new Error('flood wait'));
      mockGetVideoThumbnail.mockResolvedValueOnce({
        thumbnail: 'data:image/jpeg;base64,full-2',
        thumbnail_width: 320,
        thumbnail_height: 180,
      });

      const res = await request(buildApp()).get('/channels/chat1/videos').query({ thumbnail: 'true' });

      expect(res.status).toBe(200);
      expect(res.body.data[0].thumbnail).toBeNull();
      expect(res.body.data[1].thumbnail).toBe('data:image/jpeg;base64,full-2');
    });

    it('resolves thumbnails only for the items in the requested page', async () => {
      mockGetVideoThumbnail.mockResolvedValue({
        thumbnail: 'data:image/jpeg;base64,full',
        thumbnail_width: 320,
        thumbnail_height: 180,
      });

      await request(buildApp()).get('/channels/chat1/videos').query({ thumbnail: 'true', file_name: 'b' });

      expect(mockGetVideoThumbnail).toHaveBeenCalledTimes(1);
      expect(mockGetVideoThumbnail).toHaveBeenCalledWith('chat1', 2);
    });

    it('returns 400 for an invalid thumbnail value', async () => {
      const res = await request(buildApp()).get('/channels/chat1/videos').query({ thumbnail: 'huge' });
      expect(res.status).toBe(400);
    });
  });

  it('returns 500 with the error message when getChannelVideos rejects', async () => {
    mockGetChannelVideos.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/channels/chat1/videos');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
