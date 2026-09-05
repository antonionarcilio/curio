import bigInt from 'big-integer';
import express from 'express';
import request from 'supertest';

const mockGetAudioMessage = jest.fn();
const mockGetFile = jest.fn();

jest.mock('@/telegram-client', () => ({
  client: { _media: { getFile: mockGetFile } },
  getAudioMessage: mockGetAudioMessage,
}));

import downloadAudioRouter from '@/routes/audio/dl/route';
import streamAudioRouter from '@/routes/audio/stream/route';
import { CHUNK_SIZE } from '@/utils/http-response';
import { mountRouter } from '@test/helpers/mount-router';

function document() {
  return {
    id: bigInt(1),
    accessHash: bigInt(2),
    fileReference: Buffer.from('file-reference'),
    dcId: 4,
  };
}

function audioMessage(size: number, overrides: Record<string, unknown> = {}) {
  return {
    document: document(),
    size,
    mimeType: 'audio/mpeg',
    fileName: 'song.mp3',
    ...overrides,
  };
}

const buildApp = () => mountRouter([streamAudioRouter, downloadAudioRouter]);

describe('GET /audio/stream/:chatId/:messageId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('streams the full file with 200 when there is no Range header', async () => {
    mockGetAudioMessage.mockResolvedValue(audioMessage(11));
    mockGetFile.mockResolvedValue(Buffer.from('hello world'));

    const res = await request(buildApp())
      .get('/audio/stream/chat1/1')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('11');
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect((res.body as Buffer).toString()).toBe('hello world');
  });

  it('streams a partial range with 206 and a correct Content-Range', async () => {
    mockGetAudioMessage.mockResolvedValue(audioMessage(11));
    mockGetFile.mockResolvedValue(Buffer.from('hello'));

    const res = await request(buildApp())
      .get('/audio/stream/chat1/1')
      .set('Range', 'bytes=0-4')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-4/11');
    expect(res.headers['content-length']).toBe('5');
    expect((res.body as Buffer).toString()).toBe('hello');
  });

  it('returns 404 with the error message when getAudioMessage rejects', async () => {
    mockGetAudioMessage.mockRejectedValue(new Error('Mensagem não encontrada'));

    const res = await request(buildApp()).get('/audio/stream/chat1/999');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Mensagem não encontrada' });
  });

  it('falls back to application/octet-stream + attachment for an unsafe mimeType', async () => {
    mockGetAudioMessage.mockResolvedValue(audioMessage(5, { mimeType: 'text/html', fileName: 'evil.html' }));
    mockGetFile.mockResolvedValue(Buffer.from('12345'));

    const res = await request(buildApp()).get('/audio/stream/chat1/1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('downloads from the document dcId with a big-integer aligned offset', async () => {
    mockGetAudioMessage.mockResolvedValue(audioMessage(11));
    mockGetFile.mockResolvedValue(Buffer.from('xxhello'));

    await request(buildApp()).get('/audio/stream/chat1/1').set('Range', 'bytes=2-6');

    const [dcId, , offset, limit] = mockGetFile.mock.calls[0];
    expect(dcId).toBe(4);
    expect(bigInt.isInstance(offset)).toBe(true);
    expect(offset.eq(bigInt(0))).toBe(true);
    expect(limit).toBe(CHUNK_SIZE);
  });

  it('forces attachment disposition on the download route', async () => {
    mockGetAudioMessage.mockResolvedValue(audioMessage(11));
    mockGetFile.mockResolvedValue(Buffer.from('hello world'));

    const res = await request(buildApp()).get('/audio/dl/chat1/1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('waits for the "drain" event when res.write reports backpressure', async () => {
    mockGetAudioMessage.mockResolvedValue(audioMessage(11));
    mockGetFile.mockResolvedValue(Buffer.from('hello world'));

    const app = express();
    app.use((req, res, next) => {
      const originalWrite = res.write.bind(res);
      let writeCount = 0;
      jest.spyOn(res, 'write').mockImplementation(((chunk: Buffer) => {
        writeCount += 1;
        originalWrite(chunk);
        if (writeCount === 1) {
          setImmediate(() => res.emit('drain'));
          return false;
        }
        return true;
      }) as typeof res.write);
      next();
    });
    app.use(streamAudioRouter);

    const res = await request(app)
      .get('/audio/stream/chat1/1')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toBe('hello world');
  });

  it('ends the response without a JSON error body when MediaScheduler getFile fails after headers are sent', async () => {
    mockGetAudioMessage.mockResolvedValue(audioMessage(CHUNK_SIZE + 20));
    mockGetFile.mockResolvedValueOnce(Buffer.alloc(CHUNK_SIZE, 'a'));
    mockGetFile.mockRejectedValueOnce(new Error('boom mid-stream'));

    let caughtError: Error | undefined;
    try {
      await request(buildApp()).get('/audio/stream/chat1/1').buffer(true);
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError?.message).toBe('aborted');
  });
});
