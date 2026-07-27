import { createSignedUrl } from '@/signed-url';
import { client, ensureConnected } from '@/telegram-client';
import fs from 'fs';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { uploadTestFixture } from './helpers/upload-fixture';
import { deleteFixtureViaApi, TARGETS, TEST_VIDEO_PATH } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

// Só o range é baixado por asserção (o fixture tem ~177MB) — a única exceção é
// o teste de download completo, feito uma única vez pro alvo mais rápido
// ("me"), o suficiente pra provar que o caminho sem Range também funciona
// byte a byte sem baixar o arquivo inteiro em toda combinação de teste/alvo.
describe.each(TARGETS)('GET /api/v1/video/stream/:chatId/:messageId (e2e) — $label', ({ chatId, isChannel }) => {
  let messageId: number;

  beforeAll(async () => {
    const job = await uploadTestFixture(chatId, TEST_VIDEO_PATH);
    if (job.status !== 'completed' || !job.message_id) throw new Error(`Falha ao criar fixture para "${chatId}"`);
    messageId = job.message_id;
  });

  afterAll(async () => {
    if (messageId) await deleteFixtureViaApi(chatId, messageId);
  });

  it('streams a byte-exact partial range with 206 and a correct Content-Range', async () => {
    const localBytes = fs.readFileSync(TEST_VIDEO_PATH).subarray(0, 65536);
    const size = fs.statSync(TEST_VIDEO_PATH).size;

    const res = await authed(request(app).get(`/api/v1/video/stream/${chatId}/${messageId}`))
      .set('Range', 'bytes=0-65535')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-65535/${size}`);
    expect(res.headers['content-disposition']).toMatch(/^inline/);
    expect((res.body as Buffer).equals(localBytes)).toBe(true);
  });

  if (!isChannel) {
    it('streams the full file with 200 when there is no Range header', async () => {
      const localBuffer = fs.readFileSync(TEST_VIDEO_PATH);

      const res = await authed(request(app).get(`/api/v1/video/stream/${chatId}/${messageId}`))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-length']).toBe(String(localBuffer.length));
      expect((res.body as Buffer).equals(localBuffer)).toBe(true);
    }, 900_000);
  }

  it('accepts a signed url with no Authorization header', async () => {
    const signedUrl = createSignedUrl('', chatId, messageId);

    const res = await request(app).get(signedUrl).set('Range', 'bytes=0-1023');

    expect(res.status).toBe(206);
  });

  it('rejects a tampered signature with 401', async () => {
    const signedUrl = createSignedUrl('', chatId, messageId).replace(/sig=[0-9a-f]+/, 'sig=0000000000000000');

    const res = await request(app).get(signedUrl).set('Range', 'bytes=0-1023');

    expect(res.status).toBe(401);
  });
});
