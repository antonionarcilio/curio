import request from 'supertest';

const mockUploadVideo = jest.fn();

// Limite pequeno só pra tornar o teste de rejeição por tamanho determinístico
// e barato (o limite real, MAX_UPLOAD_SIZE_BYTES = 2GB, tornaria o teste caro
// de simular); os outros testes deste arquivo usam buffers bem menores que 20.
jest.mock('@/telegram-client', () => ({
  uploadVideo: mockUploadVideo,
  MAX_UPLOAD_SIZE_BYTES: 20,
}));

import { getJob } from '@/jobs/upload-progress-store';
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

// uploadVideo roda em background, fora do ciclo request/response — dá um
// respiro pro event loop processar o .then/.catch encadeado na rota antes de
// inspecionar o estado do job.
async function waitForJobSettled(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = getJob(jobId);
    if (job && job.status !== 'queued' && job.status !== 'uploading') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('POST /video/upload/:chatId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts the upload and returns a queued job id immediately', async () => {
    mockUploadVideo.mockResolvedValue(uploadedVideo);

    const res = await request(buildApp())
      .post('/video/upload/me')
      .field('description', 'uma descrição')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' })
      .attach('thumbnail', Buffer.from('thumb-bytes'), { filename: 'thumb.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('queued');
    expect(typeof res.body.job_id).toBe('string');

    await waitForJobSettled(res.body.job_id);
    expect(mockUploadVideo).toHaveBeenCalledTimes(1);
    const [chatId, params] = mockUploadVideo.mock.calls[0];
    expect(chatId).toBe('me');
    expect(params.originalFileName).toBe('original.mp4');
    expect(params.description).toBe('uma descrição');
    expect(Buffer.isBuffer(params.buffer)).toBe(true);
    expect(Buffer.isBuffer(params.thumbnailBuffer)).toBe(true);
    expect(typeof params.onProgress).toBe('function');

    params.onProgress(0.5);
    expect(getJob(res.body.job_id)?.progress).toBe(0.5);
  });

  it('completes the job with the uploaded video metadata and a signed url', async () => {
    mockUploadVideo.mockResolvedValue(uploadedVideo);

    const res = await request(buildApp())
      .post('/video/upload/me')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' });

    await waitForJobSettled(res.body.job_id);
    const job = getJob(res.body.job_id);
    expect(job?.status).toBe('completed');
    expect(job?.progress).toBe(1);
    expect(job?.result).toMatchObject(uploadedVideo);
    expect(job?.result?.url).toMatch(/^http:\/\/.+\/api\/v1\/video\/stream\/me\/42\?exp=\d+&sig=[0-9a-f]+$/);
  });

  it('uploads a video with only the required file field', async () => {
    mockUploadVideo.mockResolvedValue(uploadedVideo);

    const res = await request(buildApp())
      .post('/video/upload/me')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(202);
    await waitForJobSettled(res.body.job_id);
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

  it('marks the job as failed when uploadVideo rejects', async () => {
    mockUploadVideo.mockRejectedValue(new Error('boom'));

    const res = await request(buildApp())
      .post('/video/upload/me')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(202);
    await waitForJobSettled(res.body.job_id);
    const job = getJob(res.body.job_id);
    expect(job?.status).toBe('error');
    expect(job?.error).toBe('boom');
  });

  it('keeps a second concurrent upload queued until the first settles (UPLOAD_CONCURRENCY_LIMIT default 1)', async () => {
    let resolveFirst!: (value: typeof uploadedVideo) => void;
    mockUploadVideo.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    mockUploadVideo.mockResolvedValueOnce(uploadedVideo);

    const app = buildApp();
    const firstRes = await request(app)
      .post('/video/upload/me')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' });
    const secondRes = await request(app)
      .post('/video/upload/me')
      .attach('file', Buffer.from('video-bytes'), { filename: 'original.mp4', contentType: 'video/mp4' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getJob(firstRes.body.job_id)?.status).toBe('uploading');
    expect(getJob(secondRes.body.job_id)?.status).toBe('queued');

    resolveFirst(uploadedVideo);
    await waitForJobSettled(secondRes.body.job_id);
    expect(getJob(secondRes.body.job_id)?.status).toBe('completed');
  });
});
