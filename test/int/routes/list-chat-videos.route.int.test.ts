import request from 'supertest';

const mockListVideos = jest.fn();

jest.mock('@/telegram-client', () => ({
  listVideos: mockListVideos,
}));

import videosByRouter from '@/routes/videos/by/route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter(videosByRouter);

const item = (message_id: number) => ({
  message_id,
  file_name: `${message_id}.mp4`,
  size: 100,
  mime_type: 'video/mp4',
  date: 1700000000,
});

const richItem = (message_id: number) => ({
  ...item(message_id),
  description: 'uma descrição',
  duration: 12,
  width: 1920,
  height: 1080,
  supports_streaming: true,
  thumbnail_width: 1280,
  thumbnail_height: 720,
  thumbnail: 'data:image/jpeg;base64,stripped',
});

describe('GET /videos/by/:chatId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the chat envelope when unpaginated', async () => {
    mockListVideos.mockResolvedValue({ items: [item(1), item(2)], total: 2 });

    const res = await request(buildApp()).get('/videos/by/chat1');

    expect(res.status).toBe(200);
    expect(res.body.chat_id).toBe('chat1');
    expect(res.body.data).toEqual([
      { ...item(1), url: expect.stringMatching(/^http:\/\/.+\/api\/v1\/video\/stream\/chat1\/1\?/) },
      { ...item(2), url: expect.stringMatching(/^http:\/\/.+\/api\/v1\/video\/stream\/chat1\/2\?/) },
    ]);
    expect(mockListVideos).toHaveBeenCalledWith('chat1', { limit: 100, offset: 0 });
  });

  it('keeps rich video metadata in each item', async () => {
    mockListVideos.mockResolvedValue({ items: [richItem(1)], total: 1 });

    const res = await request(buildApp()).get('/videos/by/chat1');

    expect(res.body.data[0]).toMatchObject(richItem(1));
  });

  it('keeps rich metadata in the paginated envelope too', async () => {
    mockListVideos.mockResolvedValue({ items: [richItem(3)], total: 1 });

    const res = await request(buildApp()).get('/videos/by/chat1').query({ page: 1 });

    expect(res.body.data[0]).toMatchObject(richItem(3));
  });

  it('returns a paginated envelope built from native pagination when page/per_page are given', async () => {
    mockListVideos.mockResolvedValue({ items: [item(3)], total: 21 });

    const res = await request(buildApp()).get('/videos/by/chat1').query({ page: 3, per_page: 10 });

    expect(mockListVideos).toHaveBeenCalledWith('chat1', { limit: 10, offset: 20 });
    expect(res.body).toMatchObject({ chat_id: 'chat1', page: 3, per_page: 10, total: 21, total_pages: 3 });
    expect(res.body.data).toEqual([
      { ...item(3), url: expect.stringMatching(/^http:\/\/.+\/api\/v1\/video\/stream\/chat1\/3\?/) },
    ]);
  });

  it('returns 400 for an invalid query', async () => {
    const res = await request(buildApp()).get('/videos/by/chat1').query({ per_page: 1000 });
    expect(res.status).toBe(400);
  });

  it('returns 500 with the error message when listVideos rejects', async () => {
    mockListVideos.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/videos/by/chat1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
