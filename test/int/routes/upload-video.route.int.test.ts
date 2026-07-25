import request from 'supertest';

const mockUploadVideo = jest.fn();

// Limite pequeno só pra tornar o teste de rejeição por tamanho determinístico
// e barato (o limite real, MAX_UPLOAD_SIZE_BYTES = 2GB, tornaria o teste caro
// de simular); os outros testes deste arquivo usam buffers bem menores que 20.
jest.mock('@/telegram-client', () => ({
  uploadVideo: mockUploadVideo,
  MAX_UPLOAD_SIZE_BYTES: 20,
}));

import uploadVideoRouter from '@/routes/video/upload/route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter(uploadVideoRouter);

const uploadedVideo = {
  message_id: 42,
  file_name: 'video.mp4',
  size: 11,
  mime_type: 'video/mp4',
  date: 1700000000,
};

describe('POST /video/upload/:chatId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads a video with description and thumbnail, returning metadata and a signed url', async () => {
    mockUploadVideo.mockResolvedValue(uploadedVideo);

    const res = await request(buildApp())
      .post('/video/upload/me')
      .field('description', 'uma descrição')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' })
      .attach('thumbnail', Buffer.from('thumb-bytes'), { filename: 'thumb.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(uploadedVideo);
    expect(res.body.chat_id).toBe('me');
    expect(res.body.url).toMatch(/^http:\/\/.+\/api\/v1\/video\/stream\/me\/42\?exp=\d+&sig=[0-9a-f]+$/);

    expect(mockUploadVideo).toHaveBeenCalledTimes(1);
    const [chatId, params] = mockUploadVideo.mock.calls[0];
    expect(chatId).toBe('me');
    expect(params.originalFileName).toBe('original.mp4');
    expect(params.description).toBe('uma descrição');
    expect(Buffer.isBuffer(params.buffer)).toBe(true);
    expect(Buffer.isBuffer(params.thumbnailBuffer)).toBe(true);
  });

  it('uploads a video with only the required file field', async () => {
    mockUploadVideo.mockResolvedValue(uploadedVideo);

    const res = await request(buildApp())
      .post('/video/upload/me')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(200);
    const params = mockUploadVideo.mock.calls[0][1];
    expect(params.description).toBeUndefined();
    expect(params.thumbnailBuffer).toBeUndefined();
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(buildApp()).post('/video/upload/me').field('description', 'sem arquivo');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockUploadVideo).not.toHaveBeenCalled();
  });

  it('returns 400 when the uploaded file mimetype is not video/*', async () => {
    const res = await request(buildApp())
      .post('/video/upload/me')
      .attach('file', Buffer.from('not-a-video'), { filename: 'file.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockUploadVideo).not.toHaveBeenCalled();
  });

  it('returns 400 when the file exceeds MAX_UPLOAD_SIZE_BYTES', async () => {
    const res = await request(buildApp())
      .post('/video/upload/me')
      .attach('file', Buffer.from('this buffer is over 20 bytes long'), {
        filename: 'original.mp4',
        contentType: 'video/mp4',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Arquivo maior que o limite/);
    expect(mockUploadVideo).not.toHaveBeenCalled();
  });

  it('returns 500 with the error message when uploadVideo rejects', async () => {
    mockUploadVideo.mockRejectedValue(new Error('boom'));

    const res = await request(buildApp())
      .post('/video/upload/me')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
