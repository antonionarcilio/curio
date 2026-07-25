import { createSignedUrl } from '@/signed-url';
import { client, ensureConnected } from '@/telegram-client';
import fs from 'fs';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { readFixtureState } from './helpers/shared-state';
import { TARGETS, TEST_VIDEO_PATH } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

// Mesma lógica de stream-video (código compartilhado em src/services/videos/stream.ts),
// só muda o Content-Disposition — full-body byte-a-byte já foi provado lá, aqui
// só range (evita baixar os ~177MB de novo em toda combinação).
describe.each(TARGETS)('GET /api/v1/video/dl/:chatId/:messageId (e2e) — $label', ({ chatId }) => {
  function fixture() {
    const found = readFixtureState(chatId);
    if (!found) throw new Error(`Fixture ausente para "${chatId}" — upload-video.e2e.test.ts precisa rodar antes`);
    return found;
  }

  it('streams a byte-exact partial range with 206, forcing Content-Disposition: attachment', async () => {
    const { messageId } = fixture();
    const localBytes = fs.readFileSync(TEST_VIDEO_PATH).subarray(0, 65536);
    const size = fs.statSync(TEST_VIDEO_PATH).size;

    const res = await authed(request(app).get(`/api/v1/video/dl/${chatId}/${messageId}`))
      .set('Range', 'bytes=0-65535')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-65535/${size}`);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect((res.body as Buffer).equals(localBytes)).toBe(true);
  });

  it('accepts a signed url with no Authorization header', async () => {
    const { messageId } = fixture();
    // A assinatura só depende de chatId:messageId:exp, não do prefixo do path
    // — createSignedUrl sempre aponta pra /video/stream/..., então troca o
    // segmento pra exercitar o mesmo bypass na rota de download.
    const signedUrl = createSignedUrl('', chatId, messageId).replace('/video/stream/', '/video/dl/');

    const res = await request(app).get(signedUrl).set('Range', 'bytes=0-1023');

    expect(res.status).toBe(206);
  });

  it('rejects a tampered signature with 401', async () => {
    const { messageId } = fixture();
    const signedUrl = createSignedUrl('', chatId, messageId)
      .replace('/video/stream/', '/video/dl/')
      .replace(/sig=[0-9a-f]+/, 'sig=0000000000000000');

    const res = await request(app).get(signedUrl).set('Range', 'bytes=0-1023');

    expect(res.status).toBe(401);
  });
});
