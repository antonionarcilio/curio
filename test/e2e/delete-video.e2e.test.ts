import { client, deleteVideoMessage, ensureConnected, getVideoMessage } from '@/telegram-client';
import { TARGETS, uploadFixture } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
afterAll(() => client.disconnect());

describe.each(TARGETS)('deleteVideoMessage (e2e) — $label', ({ chatId }) => {
  it('removes the message and it stops being found afterward', async () => {
    const messageId = await uploadFixture(chatId);

    await deleteVideoMessage(chatId, messageId);

    await expect(getVideoMessage(chatId, messageId)).rejects.toThrow('Mensagem não encontrada');
  });
});
