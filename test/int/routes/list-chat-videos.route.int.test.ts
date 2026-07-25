import request from 'supertest';

const mockListVideos = jest.fn();

jest.mock('@/telegram-client', () => ({
  listVideos: mockListVideos,
}));

import listChatVideosRouter from '@/routes/list-chat-videos.route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter(listChatVideosRouter);

const item = (message_id: number) => ({
  message_id,
  file_name: `${message_id}.mp4`,
  size: 100,
  mime_type: 'video/mp4',
  date: 1700000000,
});

// listVideos devolve os itens ricos usados por /channels/:channelId/videos;
// /list/:chatId propositalmente mantém o shape enxuto.
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

describe('GET /list/:chatId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the flat items array when unpaginated', async () => {
    mockListVideos.mockResolvedValue({ items: [item(1), item(2)], total: 2 });

    const res = await request(buildApp()).get('/list/chat1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([item(1), item(2)]);
    expect(mockListVideos).toHaveBeenCalledWith('chat1', { limit: 100, offset: 0 });
  });

  it('drops the channel-only metadata (thumbnail, duration, …) from each item', async () => {
    mockListVideos.mockResolvedValue({ items: [richItem(1)], total: 1 });

    const res = await request(buildApp()).get('/list/chat1');

    expect(res.body).toEqual([item(1)]);
  });

  it('drops the channel-only metadata in the paginated envelope too', async () => {
    mockListVideos.mockResolvedValue({ items: [richItem(3)], total: 1 });

    const res = await request(buildApp()).get('/list/chat1').query({ page: 1 });

    expect(res.body.data).toEqual([item(3)]);
  });

  it('returns a paginated envelope built from native pagination when page/per_page are given', async () => {
    mockListVideos.mockResolvedValue({ items: [item(3)], total: 21 });

    const res = await request(buildApp()).get('/list/chat1').query({ page: 3, per_page: 10 });

    expect(mockListVideos).toHaveBeenCalledWith('chat1', { limit: 10, offset: 20 });
    expect(res.body).toEqual({ data: [item(3)], page: 3, per_page: 10, total: 21, total_pages: 3 });
  });

  it('returns 400 for an invalid query', async () => {
    const res = await request(buildApp()).get('/list/chat1').query({ per_page: 1000 });
    expect(res.status).toBe(400);
  });

  it('returns 500 with the error message when listVideos rejects', async () => {
    mockListVideos.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/list/chat1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
