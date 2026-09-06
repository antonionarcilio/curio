import fs from 'fs/promises';
import request from 'supertest';

const mockUploadAudio = jest.fn();
const mockDeleteAudioMessage = jest.fn();
const mockGetUploadMaxSize = jest.fn();

// Limite pequeno só pra tornar o teste de rejeição por tamanho determinístico
// e barato; os outros testes deste arquivo usam buffers bem menores que 20.
jest.mock('@/telegram-client', () => ({
  uploadAudio: mockUploadAudio,
  deleteMessage: mockDeleteAudioMessage,
  getUploadMaxSize: mockGetUploadMaxSize,
}));

import cancelRouter from '@/routes/audio/upload-cancel/route';
import pauseAllRouter from '@/routes/audio/upload-pause-all/route';
import pauseRouter from '@/routes/audio/upload-pause/route';
import resumeAllRouter from '@/routes/audio/upload-resume-all/route';
import resumeRouter from '@/routes/audio/upload-resume/route';
import uploadAudioRouter from '@/routes/audio/upload/route';
import { getJob } from '@/services/audios/upload-progress-store';
import { mountRouter } from '@test/helpers/mount-router';

// pauseAllRouter/resumeAllRouter precisam vir antes de uploadAudioRouter —
// mesma colisão de rota resolvida em src/router.ts (`/audio/upload/pause`
// tem a mesma forma de `/audio/upload/:chatId`).
const buildApp = () =>
  mountRouter([pauseAllRouter, resumeAllRouter, uploadAudioRouter, cancelRouter, pauseRouter, resumeRouter]);

const uploadedAudio = {
  message_id: 42,
  file_name: 'song.mp3',
  size: 11,
  mime_type: 'audio/mpeg',
  date: 1700000000,
};

// uploadAudio roda em background, fora do ciclo request/response — dá um
// respiro pro event loop processar o .then/.catch encadeado na rota antes de
// inspecionar o estado do job.
async function waitForJobSettled(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = getJob(jobId);
    if (job && job.status !== 'queued' && job.status !== 'uploading') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('POST /audio/upload/:chatId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUploadMaxSize.mockResolvedValue(20);
  });

  it('accepts the upload and returns a queued job id immediately', async () => {
    let receivedAudio: Buffer | undefined;
    let receivedCover: Buffer | undefined;
    mockUploadAudio.mockImplementation(
      async (_chatId: string, params: { audioPath: string; thumbnailPath: string }) => {
        receivedAudio = await fs.readFile(params.audioPath);
        receivedCover = await fs.readFile(params.thumbnailPath);
        return uploadedAudio;
      },
    );

    const res = await request(buildApp())
      .post('/audio/upload/me')
      .field('description', 'uma descrição')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' })
      .attach('thumbnail', Buffer.from('cover-bytes'), { filename: 'cover.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('queued');
    expect(typeof res.body.job_id).toBe('string');

    await waitForJobSettled(res.body.job_id);
    expect(mockUploadAudio).toHaveBeenCalledTimes(1);
    const [chatId, params] = mockUploadAudio.mock.calls[0];
    expect(chatId).toBe('me');
    expect(params.originalFileName).toBe('original.mp3');
    expect(params.description).toBe('uma descrição');
    expect(typeof params.audioPath).toBe('string');
    expect(params.audioSize).toBe(Buffer.byteLength('audio-bytes'));
    expect(receivedAudio).toEqual(Buffer.from('audio-bytes'));
    expect(typeof params.thumbnailPath).toBe('string');
    expect(receivedCover).toEqual(Buffer.from('cover-bytes'));
    expect(params.maxUploadSizeBytes).toBe(20);
    expect(typeof params.onProgress).toBe('function');

    params.onProgress(0.5);
    expect(getJob(res.body.job_id)?.progress).toBe(0.5);
    await expect(fs.access(params.audioPath)).rejects.toThrow();
    await expect(fs.access(params.thumbnailPath)).rejects.toThrow();
  });

  it('completes the job with the uploaded audio metadata and a signed url', async () => {
    mockUploadAudio.mockResolvedValue(uploadedAudio);

    const res = await request(buildApp())
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    await waitForJobSettled(res.body.job_id);
    const job = getJob(res.body.job_id);
    expect(job?.status).toBe('completed');
    expect(job?.progress).toBe(1);
    expect(job?.result).toMatchObject(uploadedAudio);
    expect(job?.result?.url).toMatch(/^http:\/\/.+\/api\/v1\/audio\/stream\/me\/42\?exp=\d+&sig=[0-9a-f]+$/);
  });

  it('uploads an audio file with only the required file field', async () => {
    mockUploadAudio.mockResolvedValue(uploadedAudio);

    const res = await request(buildApp())
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(202);
    await waitForJobSettled(res.body.job_id);
    const params = mockUploadAudio.mock.calls[0][1];
    expect(params.description).toBeUndefined();
    expect(params.thumbnailPath).toBeUndefined();
  });

  it('uses the filename multipart field instead of the uploaded filename', async () => {
    mockUploadAudio.mockResolvedValue(uploadedAudio);

    const res = await request(buildApp())
      .post('/audio/upload/me')
      .field('filename', 'renamed-audio.mp3')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(202);
    await waitForJobSettled(res.body.job_id);
    expect(mockUploadAudio.mock.calls[0][1].originalFileName).toBe('renamed-audio.mp3');
  });

  it('ignores an empty filename and uses the multipart filename', async () => {
    mockUploadAudio.mockResolvedValue(uploadedAudio);

    const res = await request(buildApp())
      .post('/audio/upload/me')
      .field('filename', '')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(202);
    await waitForJobSettled(res.body.job_id);
    expect(mockUploadAudio.mock.calls[0][1].originalFileName).toBe('original.mp3');
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(buildApp()).post('/audio/upload/me').field('description', 'sem arquivo');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockUploadAudio).not.toHaveBeenCalled();
  });

  it('returns 400 when the uploaded file mimetype is not audio/*', async () => {
    const res = await request(buildApp())
      .post('/audio/upload/me')
      .attach('file', Buffer.from('not-an-audio-file'), { filename: 'file.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockUploadAudio).not.toHaveBeenCalled();
  });

  it('returns 400 when the cover thumbnail mimetype is not image/*', async () => {
    const res = await request(buildApp())
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' })
      .attach('thumbnail', Buffer.from('not-an-image'), { filename: 'cover.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text\/plain/);
    expect(mockUploadAudio).not.toHaveBeenCalled();
  });

  it('returns 400 when the description body field is invalid', async () => {
    const res = await request(buildApp())
      .post('/audio/upload/me')
      .field('description', '   ')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockUploadAudio).not.toHaveBeenCalled();
  });

  it('returns 400 when a standard-account file exceeds its limit', async () => {
    const res = await request(buildApp())
      .post('/audio/upload/me')
      .attach('file', Buffer.from('this buffer is over 20 bytes long'), {
        filename: 'original.mp3',
        contentType: 'audio/mpeg',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Arquivo maior que o limite/);
    expect(mockUploadAudio).not.toHaveBeenCalled();
  });

  it('returns 503 without reading the upload when the current plan is unavailable', async () => {
    mockGetUploadMaxSize.mockRejectedValue(new Error('Telegram indisponível'));

    const res = await request(buildApp())
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/plano atual/);
    expect(mockUploadAudio).not.toHaveBeenCalled();
  });

  it('marks the job as failed when uploadAudio rejects', async () => {
    mockUploadAudio.mockRejectedValue(new Error('boom'));

    const res = await request(buildApp())
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(202);
    await waitForJobSettled(res.body.job_id);
    const job = getJob(res.body.job_id);
    expect(job?.status).toBe('error');
    expect(job?.error).toBe('boom');
  });

  it('keeps a second concurrent upload queued until the first settles (UPLOAD_CONCURRENCY_LIMIT default 1)', async () => {
    let resolveFirst!: (value: typeof uploadedAudio) => void;
    mockUploadAudio.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    mockUploadAudio.mockResolvedValueOnce(uploadedAudio);

    const app = buildApp();
    const firstRes = await request(app)
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });
    const secondRes = await request(app)
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getJob(firstRes.body.job_id)?.status).toBe('uploading');
    expect(getJob(secondRes.body.job_id)?.status).toBe('queued');

    resolveFirst(uploadedAudio);
    await waitForJobSettled(secondRes.body.job_id);
    expect(getJob(secondRes.body.job_id)?.status).toBe('completed');
  });

  it('soft-cancels an upload already in progress: deletes the audio message instead of completing the job', async () => {
    let resolveUpload!: (value: typeof uploadedAudio) => void;
    mockUploadAudio.mockImplementationOnce(() => new Promise((resolve) => (resolveUpload = resolve)));
    mockDeleteAudioMessage.mockResolvedValue(undefined);

    const app = buildApp();
    const uploadRes = await request(app)
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });
    const jobId = uploadRes.body.job_id;

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getJob(jobId)?.status).toBe('uploading');

    const cancelRes = await request(app).post(`/audio/upload/cancel/${jobId}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body).toEqual({ job_id: jobId, status: 'uploading' });

    resolveUpload(uploadedAudio);
    await waitForJobSettled(jobId);

    expect(mockDeleteAudioMessage).toHaveBeenCalledWith('me', uploadedAudio.message_id);
    expect(getJob(jobId)).toMatchObject({ status: 'cancelled' });
    expect(getJob(jobId)?.result).toBeUndefined();
  });

  it('a paused queued job does not start even after a concurrency slot frees up, until resumed', async () => {
    let resolveFirst!: (value: typeof uploadedAudio) => void;
    mockUploadAudio.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    mockUploadAudio.mockResolvedValueOnce(uploadedAudio);

    const app = buildApp();
    const firstRes = await request(app)
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });
    const secondRes = await request(app)
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });
    const secondJobId = secondRes.body.job_id;

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getJob(secondJobId)?.status).toBe('queued');

    const pauseRes = await request(app).post(`/audio/upload/pause/${secondJobId}`);
    expect(pauseRes.status).toBe(200);

    resolveFirst(uploadedAudio);
    await waitForJobSettled(firstRes.body.job_id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getJob(secondJobId)?.status).toBe('paused');
    expect(mockUploadAudio).toHaveBeenCalledTimes(1);

    const resumeRes = await request(app).post(`/audio/upload/resume/${secondJobId}`);
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body).toEqual({ job_id: secondJobId, status: 'queued' });

    await waitForJobSettled(secondJobId);
    expect(getJob(secondJobId)?.status).toBe('completed');
    expect(mockUploadAudio).toHaveBeenCalledTimes(2);
  });

  it('pause-all and resume-all act on every queued/paused job at once', async () => {
    let resolveFirst!: (value: typeof uploadedAudio) => void;
    mockUploadAudio.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    mockUploadAudio.mockResolvedValue(uploadedAudio);

    const app = buildApp();
    const firstRes = await request(app)
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });
    const secondRes = await request(app)
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });
    const thirdRes = await request(app)
      .post('/audio/upload/me')
      .attach('file', Buffer.from('audio-bytes'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const pauseAllRes = await request(app).post('/audio/upload/pause');
    expect(pauseAllRes.status).toBe(200);
    expect(pauseAllRes.body.paused_job_ids).toEqual(
      expect.arrayContaining([secondRes.body.job_id, thirdRes.body.job_id]),
    );

    resolveFirst(uploadedAudio);
    await waitForJobSettled(firstRes.body.job_id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getJob(secondRes.body.job_id)?.status).toBe('paused');
    expect(getJob(thirdRes.body.job_id)?.status).toBe('paused');
    expect(mockUploadAudio).toHaveBeenCalledTimes(1);

    const resumeAllRes = await request(app).post('/audio/upload/resume');
    expect(resumeAllRes.status).toBe(200);
    expect(resumeAllRes.body.resumed_job_ids).toEqual(
      expect.arrayContaining([secondRes.body.job_id, thirdRes.body.job_id]),
    );

    await waitForJobSettled(secondRes.body.job_id);
    await waitForJobSettled(thirdRes.body.job_id);
    expect(getJob(secondRes.body.job_id)?.status).toBe('completed');
    expect(getJob(thirdRes.body.job_id)?.status).toBe('completed');
  });
});
