import request from 'supertest';

import healthRouter from '@/routes/health/route';
import { mountRouter } from '@test/helpers/mount-router';

describe('GET /health', () => {
  const app = mountRouter(healthRouter);

  it('responds with 200 and { status: "ok" }', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
