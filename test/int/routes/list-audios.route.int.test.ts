import request from 'supertest';

const mockListAllAudios = jest.fn();

jest.mock('@/telegram-client', () => ({
  listAllAudios: mockListAllAudios,
}));

import groupedAudiosRouter from '@/routes/audios/grouped/route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter(groupedAudiosRouter);

const item = (
  chat_id: string,
  chat_title: string,
  message_id: number,
  file_name: string,
  description: string | null = null,
) => ({
  chat_id,
  chat_title,
  message_id,
  file_name,
  size: 100,
  mime_type: 'audio/mpeg',
  date: 1700000000,
  description,
});

describe('GET /audios/grouped', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a flat array with a signed /api/v1/audio/stream/... url per item', async () => {
    mockListAllAudios.mockResolvedValue([item('1', 'Chat 1', 1, 'a.mp3')]);

    const res = await request(buildApp()).get('/audios/grouped');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].url).toMatch(/^http:\/\/[^/]+\/api\/v1\/audio\/stream\/1\/1\?/);
  });

  it('combines chat_id/chat_title/file_name/description filters with AND semantics', async () => {
    mockListAllAudios.mockResolvedValue([
      item('1', 'Chat 1', 1, 'song.mp3', 'a nice song'),
      item('2', 'Chat 2', 2, 'other.mp3', 'a nice song'),
    ]);

    const res = await request(buildApp()).get('/audios/grouped').query({ chat_id: '1', description: 'nice' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].message_id).toBe(1);
  });

  it('returns a paginated envelope when page/per_page are given', async () => {
    mockListAllAudios.mockResolvedValue([item('1', 'Chat 1', 1, 'a.mp3'), item('1', 'Chat 1', 2, 'b.mp3')]);

    const res = await request(buildApp()).get('/audios/grouped').query({ page: 1, per_page: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, per_page: 1, total: 2, total_pages: 2 });
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 400 when per_page exceeds the cap', async () => {
    const res = await request(buildApp()).get('/audios/grouped').query({ per_page: 1000 });
    expect(res.status).toBe(400);
  });

  it('returns 500 with the error message when listAllAudios rejects', async () => {
    mockListAllAudios.mockRejectedValue(new Error('boom'));

    const res = await request(buildApp()).get('/audios/grouped');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
