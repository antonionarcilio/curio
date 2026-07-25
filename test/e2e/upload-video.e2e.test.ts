import { client, ensureConnected } from '@/telegram-client';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app, authed } from './helpers/http-client';
import { writeFixtureState } from './helpers/shared-state';
import {
  buildSmallThumbnailBuffer,
  ORIGINAL_DESCRIPTION,
  TARGETS,
  TEST_FILE_NAME,
  TEST_VIDEO_PATH,
} from './helpers/video-fixture';

beforeAll(() => ensureConnected());
// destroy() (não disconnect()) marca client._destroyed = true — sem isso o
// _updateLoop interno do GramJS continua acordando a cada 9s pra pingar um
// sender já desconectado, gerando "[Error: TIMEOUT]"/"Cannot log after tests
// are done" indefinidamente e travando o processo do Jest aberto no final.
afterAll(() => client.destroy());

describe.each(TARGETS)('POST /api/v1/video/upload/:chatId (e2e) — $label', ({ chatId }) => {
  it('uploads the real video with a resized thumbnail and returns matching metadata', async () => {
    const videoBuffer = fs.readFileSync(TEST_VIDEO_PATH);
    const thumbnailBuffer = await buildSmallThumbnailBuffer();

    const res = await authed(request(app).post(`/api/v1/video/upload/${chatId}`))
      .field('description', ORIGINAL_DESCRIPTION)
      .attach('file', videoBuffer, { filename: path.basename(TEST_VIDEO_PATH), contentType: 'video/mp4' })
      .attach('thumbnail', thumbnailBuffer, { filename: 'thumb.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.chat_id).toBe(chatId);
    expect(res.body.file_name).toBe(TEST_FILE_NAME);
    expect(res.body.mime_type).toMatch(/^video\//);
    expect(res.body.size).toBeGreaterThan(0);
    expect(res.body.url).toMatch(/^http:\/\/.+\/api\/v1\/video\/stream\/.+\?exp=\d+&sig=[0-9a-f]+$/);

    writeFixtureState(chatId, { messageId: res.body.message_id });
  });
});
