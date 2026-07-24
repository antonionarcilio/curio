import express from 'express';
import request from 'supertest';

const mockListChannels = jest.fn();

jest.mock('../../src/telegram-client', () => ({
  listChannels: mockListChannels,
}));

import listChannelsRouter from '../../src/routes/list-channels.route';

function buildApp() {
  const app = express();
  app.use(listChannelsRouter);
  return app;
}

describe('GET /channels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the flat channel list when unpaginated', async () => {
    mockListChannels.mockResolvedValue([
      { channel_id: '1', channel_title: 'Channel A' },
      { channel_id: '2', channel_title: 'Channel B' },
    ]);

    const res = await request(buildApp()).get('/channels');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { channel_id: '1', channel_title: 'Channel A' },
      { channel_id: '2', channel_title: 'Channel B' },
    ]);
  });

  it('filters by channel_id (ignoring sign) and channel_title (accent/case-insensitive)', async () => {
    mockListChannels.mockResolvedValue([
      { channel_id: '-100111', channel_title: 'Séries' },
      { channel_id: '-100222', channel_title: 'Filmes' },
    ]);

    const byId = await request(buildApp()).get('/channels').query({ channel_id: '100111' });
    expect(byId.body).toEqual([{ channel_id: '-100111', channel_title: 'Séries' }]);

    const byTitle = await request(buildApp()).get('/channels').query({ channel_title: 'series' });
    expect(byTitle.body).toEqual([{ channel_id: '-100111', channel_title: 'Séries' }]);
  });

  it('returns a paginated envelope when page/per_page are given', async () => {
    mockListChannels.mockResolvedValue([
      { channel_id: '1', channel_title: 'A' },
      { channel_id: '2', channel_title: 'B' },
      { channel_id: '3', channel_title: 'C' },
    ]);

    const res = await request(buildApp()).get('/channels').query({ page: 2, per_page: 2 });

    expect(res.body).toMatchObject({ page: 2, per_page: 2, total: 3, total_pages: 2 });
    expect(res.body.data).toEqual([{ channel_id: '3', channel_title: 'C' }]);
  });

  it('returns 400 for an invalid query', async () => {
    const res = await request(buildApp()).get('/channels').query({ page: '0' });
    expect(res.status).toBe(400);
  });

  it('returns 500 with the error message when listChannels rejects', async () => {
    mockListChannels.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/channels');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
