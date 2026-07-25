import express from 'express';
import request from 'supertest';

const mockUploadVideo = jest.fn();

jest.mock('../../src/telegram-client', () => ({
  uploadVideo: mockUploadVideo,
}));

import uploadVideoRouter from '../../src/routes/upload-video.route';

function buildApp() {
  const app = express();
  app.use(uploadVideoRouter);
  return app;
}

const uploadedVideo = {
  message_id: 42,
  file_name: 'video.mp4',
  size: 11,
  mime_type: 'video/mp4',
  date: 1700000000,
};

describe('POST /video/:chatId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads a video with file_name, description and thumbnail, returning metadata and a signed url', async () => {
    mockUploadVideo.mockResolvedValue(uploadedVideo);

    const res = await request(buildApp())
      .post('/video/me')
      .field('file_name', 'custom.mp4')
      .field('description', 'uma descrição')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' })
      .attach('thumbnail', Buffer.from('thumb-bytes'), { filename: 'thumb.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(uploadedVideo);
    expect(res.body.chat_id).toBe('me');
    expect(res.body.url).toMatch(/^http:\/\/.+\/video\/me\/42\?exp=\d+&sig=[0-9a-f]+$/);

    expect(mockUploadVideo).toHaveBeenCalledTimes(1);
    const [chatId, params] = mockUploadVideo.mock.calls[0];
    expect(chatId).toBe('me');
    expect(params.originalFileName).toBe('original.mp4');
    expect(params.fileName).toBe('custom.mp4');
    expect(params.description).toBe('uma descrição');
    expect(Buffer.isBuffer(params.buffer)).toBe(true);
    expect(Buffer.isBuffer(params.thumbnailBuffer)).toBe(true);
  });

  it('uploads a video with only the required file field', async () => {
    mockUploadVideo.mockResolvedValue(uploadedVideo);

    const res = await request(buildApp())
      .post('/video/me')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(200);
    const params = mockUploadVideo.mock.calls[0][1];
    expect(params.fileName).toBeUndefined();
    expect(params.description).toBeUndefined();
    expect(params.thumbnailBuffer).toBeUndefined();
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(buildApp()).post('/video/me').field('description', 'sem arquivo');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockUploadVideo).not.toHaveBeenCalled();
  });

  it('returns 400 when the uploaded file mimetype is not video/*', async () => {
    const res = await request(buildApp())
      .post('/video/me')
      .attach('file', Buffer.from('not-a-video'), { filename: 'file.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockUploadVideo).not.toHaveBeenCalled();
  });

  it('returns 500 with the error message when uploadVideo rejects', async () => {
    mockUploadVideo.mockRejectedValue(new Error('boom'));

    const res = await request(buildApp())
      .post('/video/me')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
