import bigInt from 'big-integer';
import express from 'express';
import http from 'http';
import request from 'supertest';

const mockGetVideoMessage = jest.fn();
const mockIterDownload = jest.fn();

jest.mock('../../src/telegram-client', () => ({
  client: { iterDownload: mockIterDownload },
  getVideoMessage: mockGetVideoMessage,
}));

import streamVideoRouter from '../../src/routes/stream-video.route';

function fakeAsyncIterable(chunks: Buffer[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function buildApp() {
  const app = express();
  app.use(streamVideoRouter);
  return app;
}

describe('GET /video/:chatId/:messageId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('streams the full file with 200 when there is no Range header', async () => {
    mockGetVideoMessage.mockResolvedValue({
      message: { media: {} },
      size: 11,
      mimeType: 'video/mp4',
      fileName: 'video.mp4',
    });
    mockIterDownload.mockReturnValue(fakeAsyncIterable([Buffer.from('hello '), Buffer.from('world')]));

    const res = await request(buildApp())
      .get('/video/chat1/1')
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
    mockGetVideoMessage.mockResolvedValue({
      message: { media: {} },
      size: 11,
      mimeType: 'video/mp4',
      fileName: 'video.mp4',
    });
    mockIterDownload.mockReturnValue(fakeAsyncIterable([Buffer.from('hello')]));

    const res = await request(buildApp())
      .get('/video/chat1/1')
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

    const res = await request(buildApp()).get('/video/chat1/999');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Mensagem não encontrada' });
  });

  it('falls back to application/octet-stream + attachment for an unsafe mimeType', async () => {
    mockGetVideoMessage.mockResolvedValue({
      message: { media: {} },
      size: 5,
      mimeType: 'text/html',
      fileName: 'evil.html',
    });
    mockIterDownload.mockReturnValue(fakeAsyncIterable([Buffer.from('12345')]));

    const res = await request(buildApp()).get('/video/chat1/1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('passes big-integer (not native BigInt) as offset/limit to client.iterDownload', async () => {
    mockGetVideoMessage.mockResolvedValue({
      message: { media: {} },
      size: 11,
      mimeType: 'video/mp4',
      fileName: 'video.mp4',
    });
    mockIterDownload.mockReturnValue(fakeAsyncIterable([Buffer.from('hello')]));

    await request(buildApp()).get('/video/chat1/1').set('Range', 'bytes=2-6');

    const callArgs = mockIterDownload.mock.calls[0][0];
    expect(typeof callArgs.offset).not.toBe('bigint');
    expect(bigInt.isInstance(callArgs.offset)).toBe(true);
    expect(callArgs.offset.eq(bigInt(2))).toBe(true);
  });

  it('waits for the "drain" event when res.write reports backpressure', async () => {
    mockGetVideoMessage.mockResolvedValue({
      message: { media: {} },
      size: 11,
      mimeType: 'video/mp4',
      fileName: 'video.mp4',
    });
    mockIterDownload.mockReturnValue(fakeAsyncIterable([Buffer.from('hello '), Buffer.from('world')]));

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
      .get('/video/chat1/1')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toBe('hello world');
  });

  it('ends the response without a JSON error body when iterDownload fails after headers are sent', async () => {
    mockGetVideoMessage.mockResolvedValue({
      message: { media: {} },
      size: 20,
      mimeType: 'video/mp4',
      fileName: 'video.mp4',
    });
    mockIterDownload.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('first-chunk-');
        throw new Error('boom mid-stream');
      },
    });

    // The declared Content-Length (20) doesn't match the truncated body (12
    // bytes) once the stream errors mid-flight, so the connection is closed
    // abruptly instead of ending cleanly — proving the route's catch block
    // took the `res.headersSent` branch (`res.end()`) rather than trying to
    // send a JSON error body on top of an already-started response.
    let caughtError: Error | undefined;
    try {
      await request(buildApp()).get('/video/chat1/1').buffer(true);
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError?.message).toBe('aborted');
  });

  it('stops writing further chunks once the client connection is aborted', async () => {
    mockGetVideoMessage.mockResolvedValue({
      message: { media: {} },
      size: 20,
      mimeType: 'video/mp4',
      fileName: 'video.mp4',
    });

    let releaseSecondChunk!: () => void;
    const gate = new Promise<void>((resolve) => (releaseSecondChunk = resolve));

    mockIterDownload.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('first-chunk-');
        await gate;
        yield Buffer.from('second-chunk');
      },
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
      const clientReq = http.get({ host: '127.0.0.1', port, path: '/video/chat1/1' }, (res) => {
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
