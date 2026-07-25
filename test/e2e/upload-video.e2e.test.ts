import { client, ensureConnected, uploadVideo } from '@/telegram-client';
import fs from 'fs';
import path from 'path';
import { ORIGINAL_DESCRIPTION, removeFixture, TARGETS, TEST_FILE_NAME, TEST_VIDEO_PATH } from './helpers/video-fixture';

beforeAll(() => ensureConnected());
afterAll(() => client.disconnect());

describe.each(TARGETS)('uploadVideo (e2e) — $label', ({ chatId }) => {
  it('sends a real video and returns matching metadata', async () => {
    const buffer = fs.readFileSync(TEST_VIDEO_PATH);
    const video = await uploadVideo(chatId, {
      buffer,
      originalFileName: path.basename(TEST_VIDEO_PATH),
      fileName: TEST_FILE_NAME,
      description: ORIGINAL_DESCRIPTION,
    });

    try {
      expect(video.file_name).toBe(TEST_FILE_NAME);
      expect(video.mime_type).toMatch(/^video\//);
      expect(video.size).toBeGreaterThan(0);
    } finally {
      await removeFixture(chatId, video.message_id);
    }
  });
});
