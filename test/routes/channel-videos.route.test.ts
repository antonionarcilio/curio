import express from 'express';
import request from 'supertest';

const mockGetChannelVideos = jest.fn();

jest.mock('../../src/telegram-client', () => ({
  getChannelVideos: mockGetChannelVideos,
}));

import channelVideosRouter from '../../src/routes/channel-videos.route';

function buildApp() {
  const app = express();
  app.use(channelVideosRouter);
  return app;
}

const item = (message_id: number, file_name: string) => ({
  message_id,
  file_name,
  size: 100,
  mime_type: 'video/mp4',
  date: 1700000000,
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

  it('returns 500 with the error message when getChannelVideos rejects', async () => {
    mockGetChannelVideos.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/channels/chat1/videos');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
