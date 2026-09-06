import { client, ensureConnected } from '@/telegram-client';
import request from 'supertest';
import {
  deleteAudioFixtureViaApi,
  EDITED_AUDIO_DESCRIPTION,
  ORIGINAL_AUDIO_DESCRIPTION,
  TARGETS,
  TEST_AUDIO_PATH,
} from './helpers/audio-fixture';
import { app, authed } from './helpers/http-client';
import { uploadTestAudioFixture } from './helpers/upload-audio-fixture';

beforeAll(() => ensureConnected());
// destroy() é o shutdown completo do cliente TeleProto; disconnect() pode
// deixar timers/conexões internas vivos e travar o processo do Jest no final.
afterAll(() => client.destroy());

describe.each(TARGETS)('PATCH /api/v1/audio/update/:chatId/:messageId (e2e) — $label', ({ chatId }) => {
  let messageId: number;

  beforeAll(async () => {
    const job = await uploadTestAudioFixture(chatId, TEST_AUDIO_PATH, { description: ORIGINAL_AUDIO_DESCRIPTION });
    if (job.status !== 'completed' || !job.message_id) throw new Error(`Falha ao criar fixture para "${chatId}"`);
    messageId = job.message_id;
  });

  afterAll(async () => {
    if (messageId) await deleteAudioFixtureViaApi(chatId, messageId);
  });

  it('edits the caption of the uploaded fixture', async () => {
    const res = await authed(request(app).patch(`/api/v1/audio/update/${chatId}/${messageId}`)).send({
      description: EDITED_AUDIO_DESCRIPTION,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ edited: true, chat_id: chatId, message_id: String(messageId) });
  });

  it('returns 400 when description is missing', async () => {
    const res = await authed(request(app).patch(`/api/v1/audio/update/${chatId}/${messageId}`)).send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for a message id that does not exist', async () => {
    const res = await authed(request(app).patch(`/api/v1/audio/update/${chatId}/999999999`)).send({
      description: EDITED_AUDIO_DESCRIPTION,
    });

    expect(res.status).toBe(404);
  });
});
