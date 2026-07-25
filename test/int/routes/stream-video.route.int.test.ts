import bigInt from 'big-integer';
import express from 'express';
import http from 'http';
import request from 'supertest';

const mockGetVideoMessage = jest.fn();
const mockGetFile = jest.fn();

jest.mock('@/telegram-client', () => ({
  client: { _media: { getFile: mockGetFile } },
  getVideoMessage: mockGetVideoMessage,
}));

import downloadVideoRouter from '@/routes/video/dl/route';
import streamVideoRouter from '@/routes/video/stream/route';
import { CHUNK_SIZE } from '@/utils/http-response';
import { mountRouter } from '@test/helpers/mount-router';

function file(bytes: Buffer) {
  return bytes;
}

function document() {
  return {
    id: bigInt(1),
    accessHash: bigInt(2),
    fileReference: Buffer.from('file-reference'),
    dcId: 4,
  };
}

function videoMessage(size: number, overrides: Record<string, unknown> = {}) {
  return {
    document: document(),
    size,
    mimeType: 'video/mp4',
    fileName: 'video.mp4',
    ...overrides,
  };
}

const buildApp = () => mountRouter([streamVideoRouter, downloadVideoRouter]);

describe('GET /video/stream/:chatId/:messageId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('streams the full file with 200 when there is no Range header', async () => {
    mockGetVideoMessage.mockResolvedValue(videoMessage(11));
    mockGetFile.mockResolvedValue(file(Buffer.from('hello world')));

    const res = await request(buildApp())
      .get('/video/stream/chat1/1')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('11');
    expect(res.headers['content-type']).toBe('video/mp4');
    expect((res.body as Buffer).toString()).toBe('hello world');
  });

  it('streams a partial range with 206 and a correct Content-Range', async () => {
    mockGetVideoMessage.mockResolvedValue(videoMessage(11));
    mockGetFile.mockResolvedValue(file(Buffer.from('hello')));

    const res = await request(buildApp())
      .get('/video/stream/chat1/1')
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

  it('returns 404 with the error message when getVideoMessage rejects', async () => {
    mockGetVideoMessage.mockRejectedValue(new Error('Mensagem não encontrada'));

    const res = await request(buildApp()).get('/video/stream/chat1/999');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Mensagem não encontrada' });
  });

  it('falls back to application/octet-stream + attachment for an unsafe mimeType', async () => {
    mockGetVideoMessage.mockResolvedValue(videoMessage(5, { mimeType: 'text/html', fileName: 'evil.html' }));
    mockGetFile.mockResolvedValue(file(Buffer.from('12345')));

    const res = await request(buildApp()).get('/video/stream/chat1/1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('downloads from the document dcId with a big-integer aligned offset', async () => {
    mockGetVideoMessage.mockResolvedValue(videoMessage(11));
    mockGetFile.mockResolvedValue(file(Buffer.from('xxhello')));

    await request(buildApp()).get('/video/stream/chat1/1').set('Range', 'bytes=2-6');

    const [dcId, , offset, limit] = mockGetFile.mock.calls[0];
    expect(dcId).toBe(4);
    expect(typeof offset).not.toBe('bigint');
    expect(bigInt.isInstance(offset)).toBe(true);
    expect(offset.eq(bigInt(0))).toBe(true);
    expect(limit).toBe(CHUNK_SIZE);
  });

  it('fetches multiple Telegram chunks and never writes past the declared Content-Length', async () => {
    mockGetVideoMessage.mockResolvedValue(videoMessage(CHUNK_SIZE + 3));
    mockGetFile
      .mockResolvedValueOnce(file(Buffer.alloc(CHUNK_SIZE, 'a')))
      .mockResolvedValueOnce(file(Buffer.from('bcdef')));

    const res = await request(buildApp())
      .get('/video/stream/chat1/1')
      .set('Range', `bytes=0-${CHUNK_SIZE + 2}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(206);
    expect(res.headers['content-length']).toBe(String(CHUNK_SIZE + 3));
    expect(res.body as Buffer).toHaveLength(CHUNK_SIZE + 3);
    expect(mockGetFile).toHaveBeenCalledTimes(2);
    expect(mockGetFile.mock.calls[1][2].eq(bigInt(CHUNK_SIZE))).toBe(true);
    expect(mockGetFile.mock.calls[1][3]).toBe(CHUNK_SIZE);
  });

  it('forces attachment disposition on the download route', async () => {
    mockGetVideoMessage.mockResolvedValue(videoMessage(11));
    mockGetFile.mockResolvedValue(file(Buffer.from('hello world')));

    const res = await request(buildApp()).get('/video/dl/chat1/1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('waits for the "drain" event when res.write reports backpressure', async () => {
    mockGetVideoMessage.mockResolvedValue(videoMessage(11));
    mockGetFile.mockResolvedValue(file(Buffer.from('hello world')));

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
    app.use(streamVideoRouter);

    const res = await request(app)
      .get('/video/stream/chat1/1')
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
    mockGetVideoMessage.mockResolvedValue(videoMessage(CHUNK_SIZE + 20));
    mockGetFile.mockResolvedValueOnce(file(Buffer.alloc(CHUNK_SIZE, 'a')));
    mockGetFile.mockRejectedValueOnce(new Error('boom mid-stream'));

    // The declared Content-Length (20) doesn't match the truncated body (12
    // bytes) once the stream errors mid-flight, so the connection is closed
    // abruptly instead of ending cleanly — proving the route's catch block
    // took the `res.headersSent` branch (`res.end()`) rather than trying to
    // send a JSON error body on top of an already-started response.
    let caughtError: Error | undefined;
    try {
      await request(buildApp()).get('/video/stream/chat1/1').buffer(true);
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError?.message).toBe('aborted');
  });

  it('stops writing further chunks once the client connection is aborted', async () => {
    mockGetVideoMessage.mockResolvedValue(videoMessage(CHUNK_SIZE + 12));

    let releaseSecondChunk!: () => void;
    const gate = new Promise<void>((resolve) => (releaseSecondChunk = resolve));

    mockGetFile.mockResolvedValueOnce(file(Buffer.alloc(CHUNK_SIZE, 'a')));
    mockGetFile.mockImplementationOnce(async () => {
      await gate;
      return file(Buffer.from('second-chunk'));
    });

    let writeSpy: jest.SpyInstance | undefined;
    const app = express();
    app.use((req, res, next) => {
      writeSpy = jest.spyOn(res, 'write');
      next();
    });
    app.use(streamVideoRouter);

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as { port: number };

    await new Promise<void>((resolve) => {
      const clientReq = http.get({ host: '127.0.0.1', port, path: '/video/stream/chat1/1' }, (res) => {
        res.once('data', () => {
          clientReq.destroy();
        });
      });
      clientReq.on('error', () => {
        // Destroying the request triggers an ECONNRESET-style error on some
        // Node versions — expected here, not a test failure.
      });
      clientReq.on('close', async () => {
        await new Promise((r) => setTimeout(r, 50));
        releaseSecondChunk();
        await new Promise((r) => setTimeout(r, 50));
        resolve();
      });
    });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
