import { createSignedUrl } from '@/signed-url';
import { client, ensureConnected } from '@/telegram-client';
import fs from 'fs';
import request from 'supertest';
import { deleteAudioFixtureViaApi, TARGETS, TEST_AUDIO_PATH } from './helpers/audio-fixture';
import { app, authed } from './helpers/http-client';
import { uploadTestAudioFixture } from './helpers/upload-audio-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

// O fixture de áudio é pequeno (~40KB), então cada alvo baixa o arquivo
// inteiro sem custo — ao contrário do fixture de vídeo (~177MB), não há
// necessidade de restringir o teste sem Range a um único alvo.
describe.each(TARGETS)('GET /api/v1/audio/stream/:chatId/:messageId (e2e) — $label', ({ chatId }) => {
  let messageId: number;

  beforeAll(async () => {
    const job = await uploadTestAudioFixture(chatId, TEST_AUDIO_PATH);
    if (job.status !== 'completed' || !job.message_id) throw new Error(`Falha ao criar fixture para "${chatId}"`);
    messageId = job.message_id;
  });

  afterAll(async () => {
    if (messageId) await deleteAudioFixtureViaApi(chatId, messageId);
  });

  it('streams the full file with 200 when there is no Range header', async () => {
    const localBuffer = fs.readFileSync(TEST_AUDIO_PATH);

    const res = await authed(request(app).get(`/api/v1/audio/stream/${chatId}/${messageId}`))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^inline/);
    expect(res.headers['content-length']).toBe(String(localBuffer.length));
    expect((res.body as Buffer).equals(localBuffer)).toBe(true);
  });

  it('streams a byte-exact partial range with 206 and a correct Content-Range', async () => {
    const localBytes = fs.readFileSync(TEST_AUDIO_PATH).subarray(0, 1024);
    const size = fs.statSync(TEST_AUDIO_PATH).size;

    const res = await authed(request(app).get(`/api/v1/audio/stream/${chatId}/${messageId}`))
      .set('Range', 'bytes=0-1023')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-1023/${size}`);
    expect((res.body as Buffer).equals(localBytes)).toBe(true);
  });

  it('accepts a signed url with no Authorization header', async () => {
    const signedUrl = createSignedUrl('', 'audio', chatId, messageId);

    const res = await request(app).get(signedUrl).set('Range', 'bytes=0-1023');

    expect(res.status).toBe(206);
  });

  it('rejects a tampered signature with 401', async () => {
    const signedUrl = createSignedUrl('', 'audio', chatId, messageId).replace(/sig=[0-9a-f]+/, 'sig=0000000000000000');

    const res = await request(app).get(signedUrl).set('Range', 'bytes=0-1023');

    expect(res.status).toBe(401);
  });
});
