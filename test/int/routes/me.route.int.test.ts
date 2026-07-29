import request from 'supertest';

const mockGetMyProfile = jest.fn();

jest.mock('@/telegram-client', () => ({
  getMyProfile: mockGetMyProfile,
}));

import meRouter from '@/routes/me/route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter(meRouter);

describe('GET /me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the authenticated Telegram account profile', async () => {
    mockGetMyProfile.mockResolvedValue({
      id: '123456789',
      first_name: 'Ana',
      last_name: null,
      username: 'ana',
      premium: true,
    });

    const res = await request(buildApp()).get('/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: '123456789',
      first_name: 'Ana',
      last_name: null,
      username: 'ana',
      premium: true,
    });
  });

  it('returns 500 with the error message when the Telegram profile lookup fails', async () => {
    mockGetMyProfile.mockRejectedValue(new Error('boom'));

    const res = await request(buildApp()).get('/me');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
