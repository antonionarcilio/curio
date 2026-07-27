import { client, ensureConnected } from '@/telegram-client';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { uploadTestFixture } from './helpers/upload-fixture';
import { removeFixture, TARGETS, TEST_QUEUE_VIDEO_PATH } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

describe.each(TARGETS)('DELETE /api/v1/video/delete/:chatId/:messageId (e2e) — $label', ({ chatId }) => {
  let messageId: number;

  beforeAll(async () => {
    const job = await uploadTestFixture(chatId, TEST_QUEUE_VIDEO_PATH);
    if (job.status !== 'completed' || !job.message_id) throw new Error(`Falha ao criar fixture para "${chatId}"`);
    messageId = job.message_id;
  });

  afterAll(async () => {
    // Rede de segurança: se a asserção de delete acima nunca rodou/falhou
    // antes de completar, ainda garante que o fixture não fica órfão na conta
    // real — chama a função direto, não a rota, pra não depender do que pode
    // estar quebrado (a própria rota de delete é o que este arquivo testa).
    if (messageId) {
      try {
        await removeFixture(chatId, messageId);
      } catch {
        // já deletado pelo teste principal — esperado na maioria das execuções.
      }
    }
  });

  it('deletes the fixture and it stops being reachable afterward', async () => {
    const res = await authed(request(app).delete(`/api/v1/video/delete/${chatId}/${messageId}`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, chat_id: chatId, message_id: String(messageId) });

    const streamRes = await authed(request(app).get(`/api/v1/video/stream/${chatId}/${messageId}`));
    expect(streamRes.status).toBe(404);

    const listRes = await authed(request(app).get(`/api/v1/videos/by/${chatId}`)).query({ limit: 200 });
    expect(listRes.body.data.some((entry: { message_id: number }) => entry.message_id === messageId)).toBe(false);
  });

  // Telegram's deleteMessages é idempotente — apagar um id inexistente não
  // gera erro no MTProto (diferente de editMessage, que valida existência),
  // então a rota responde 200/deleted:true mesmo aqui, não 404.
  it('returns 200 for a message id that no longer exists (Telegram deleteMessages is idempotent)', async () => {
    const res = await authed(request(app).delete(`/api/v1/video/delete/${chatId}/999999999`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, chat_id: chatId, message_id: '999999999' });
  });
});
