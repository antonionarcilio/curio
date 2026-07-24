import express from 'express';
import request from 'supertest';

jest.mock('../../src/cache/ttl-cache', () => ({
  clearAllCaches: jest.fn(),
}));

import { clearAllCaches } from '../../src/cache/ttl-cache';
import purgeCacheRouter from '../../src/routes/purge-cache.route';

describe('POST /cache/purge', () => {
  const app = express();
  app.use(purgeCacheRouter);

  it('calls clearAllCaches and responds with { purged: true }', async () => {
    const res = await request(app).post('/cache/purge');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ purged: true });
    expect(clearAllCaches).toHaveBeenCalledTimes(1);
  });
});
