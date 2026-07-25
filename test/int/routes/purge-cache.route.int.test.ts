import request from 'supertest';

jest.mock('@/utils/ttl-cache', () => ({
  clearAllCaches: jest.fn(),
}));

import purgeCacheRouter from '@/routes/cache/purge/route';
import { clearAllCaches } from '@/utils/ttl-cache';
import { mountRouter } from '@test/helpers/mount-router';

describe('POST /cache/purge', () => {
  const app = mountRouter(purgeCacheRouter);

  it('calls clearAllCaches and responds with { purged: true }', async () => {
    const res = await request(app).post('/cache/purge');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ purged: true });
    expect(clearAllCaches).toHaveBeenCalledTimes(1);
  });
});
