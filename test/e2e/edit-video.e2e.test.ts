import { client, editVideoCaption, ensureConnected, getVideoMessage } from '@/telegram-client';
import { EDITED_DESCRIPTION, removeFixture, TARGETS, uploadFixture } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
afterAll(() => client.disconnect());

describe.each(TARGETS)('editVideoCaption (e2e) — $label', ({ chatId }) => {
  let messageId: number;

  beforeAll(async () => {
    messageId = await uploadFixture(chatId);
  });

  afterAll(async () => {
    await removeFixture(chatId, messageId);
  });

  it('changes the caption of the real message', async () => {
    await editVideoCaption(chatId, messageId, EDITED_DESCRIPTION);
    const video = await getVideoMessage(chatId, messageId);
    expect(video.message.message).toBe(EDITED_DESCRIPTION);
  });
});
