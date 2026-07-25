import type { VideoListEntry } from '@/telegram-client';
import request from 'supertest';

const mockListAllVideos = jest.fn();

jest.mock('@/telegram-client', () => ({
  listAllVideos: mockListAllVideos,
}));

import listVideosRouter from '@/routes/videos/grouped/route';
import { mountRouter } from '@test/helpers/mount-router';

function makeVideo(overrides: Partial<VideoListEntry> = {}): VideoListEntry {
  return {
    chat_id: '-100111',
    chat_title: 'My Channel',
    message_id: 1,
    file_name: 'video.mp4',
    size: 100,
    mime_type: 'video/mp4',
    date: 1700000000,
    ...overrides,
  };
}

const buildApp = () => mountRouter(listVideosRouter);

describe('GET /videos/grouped', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a flat array with a signed url per item when unpaginated', async () => {
    mockListAllVideos.mockResolvedValue([makeVideo({ message_id: 1 }), makeVideo({ message_id: 2 })]);

    const res = await request(buildApp()).get('/videos/grouped');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].url).toMatch(/^http:\/\/.+\/api\/v1\/video\/stream\/-100111\/1\?exp=\d+&sig=[0-9a-f]+$/);
  });

  it('filters by chat_id, chat_title, and file_name', async () => {
    mockListAllVideos.mockResolvedValue([
      makeVideo({ message_id: 1, chat_id: '-100111', file_name: 'a.mp4' }),
      makeVideo({ message_id: 2, chat_id: '-100222', file_name: 'b.mp4' }),
    ]);

    const res = await request(buildApp()).get('/videos/grouped').query({ chat_id: '100111' });

    expect(res.body).toHaveLength(1);
    expect(res.body[0].message_id).toBe(1);
  });

  it('returns a paginated envelope when page/per_page are given', async () => {
    mockListAllVideos.mockResolvedValue([
      makeVideo({ message_id: 1 }),
      makeVideo({ message_id: 2 }),
      makeVideo({ message_id: 3 }),
    ]);

    const res = await request(buildApp()).get('/videos/grouped').query({ page: 1, per_page: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, per_page: 2, total: 3, total_pages: 2 });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].url).toBeDefined();
  });

  it('returns 400 for an invalid query (per_page above the cap)', async () => {
    const res = await request(buildApp()).get('/videos/grouped').query({ per_page: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 500 with the error message when listAllVideos rejects', async () => {
    mockListAllVideos.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/videos/grouped');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
