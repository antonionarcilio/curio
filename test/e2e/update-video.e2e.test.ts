import { client, ensureConnected } from '@/telegram-client';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { readFixtureState } from './helpers/shared-state';
import { EDITED_DESCRIPTION, TARGETS } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() (não disconnect()) marca client._destroyed = true — sem isso o
// _updateLoop interno do GramJS continua acordando a cada 9s pra pingar um
// sender já desconectado, gerando "[Error: TIMEOUT]"/"Cannot log after tests
// are done" indefinidamente e travando o processo do Jest aberto no final.
afterAll(() => client.destroy());

describe.each(TARGETS)('PATCH /api/v1/video/update/:chatId/:messageId (e2e) — $label', ({ chatId }) => {
  it('edits the caption of the uploaded fixture', async () => {
    const fixture = readFixtureState(chatId);
    if (!fixture) throw new Error(`Fixture ausente para "${chatId}" — upload-video.e2e.test.ts precisa rodar antes`);

    const res = await authed(request(app).patch(`/api/v1/video/update/${chatId}/${fixture.messageId}`)).send({
      description: EDITED_DESCRIPTION,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ edited: true, chat_id: chatId, message_id: String(fixture.messageId) });
  });

  it('returns 400 when description is missing', async () => {
    const fixture = readFixtureState(chatId);
    if (!fixture) throw new Error(`Fixture ausente para "${chatId}" — upload-video.e2e.test.ts precisa rodar antes`);

    const res = await authed(request(app).patch(`/api/v1/video/update/${chatId}/${fixture.messageId}`)).send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for a message id that does not exist', async () => {
    const res = await authed(request(app).patch(`/api/v1/video/update/${chatId}/999999999`)).send({
      description: EDITED_DESCRIPTION,
    });

    expect(res.status).toBe(404);
  });
});
