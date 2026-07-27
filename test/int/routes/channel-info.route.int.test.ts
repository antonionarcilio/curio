import request from 'supertest';

const mockGetChannelInfo = jest.fn();

jest.mock('@/telegram-client', () => ({
  getChannelInfo: mockGetChannelInfo,
}));

import channelInfoRouter from '@/routes/channel/route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter(channelInfoRouter);

describe('GET /channel/:channel_id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns basic details for the requested channel', async () => {
    mockGetChannelInfo.mockResolvedValue({
      channel_id: '-1003915432695',
      channel_title: 'Smoke Tests',
      description: 'Canal usado nos testes e2e',
      username: 'smoke_tests',
      type: 'channel',
      participants_count: 12,
      admins_count: 2,
      kicked_count: 1,
      banned_count: 0,
      online_count: 3,
    });

    const res = await request(buildApp()).get('/channel/-1003915432695');

    expect(res.status).toBe(200);
    expect(mockGetChannelInfo).toHaveBeenCalledWith('-1003915432695');
    expect(res.body).toEqual({
      channel_id: '-1003915432695',
      channel_title: 'Smoke Tests',
      description: 'Canal usado nos testes e2e',
      username: 'smoke_tests',
      type: 'channel',
      participants_count: 12,
      admins_count: 2,
      kicked_count: 1,
      banned_count: 0,
      online_count: 3,
    });
  });

  it('returns 400 for an empty channel_id segment', async () => {
    const res = await request(buildApp()).get('/channel/%20');

    expect(res.status).toBe(400);
    expect(mockGetChannelInfo).not.toHaveBeenCalled();
  });

  it('returns 500 with the error message when getChannelInfo rejects', async () => {
    mockGetChannelInfo.mockRejectedValue(new Error('boom'));

    const res = await request(buildApp()).get('/channel/-1003915432695');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
