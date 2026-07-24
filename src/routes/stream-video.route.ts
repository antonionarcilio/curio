import bigInt from 'big-integer';
import express, { type Request, type Response } from 'express';
import { client, getVideoMessage } from '../telegram-client';
import { buildContentDisposition, CHUNK_SIZE, parseRange, SAFE_MIME_TYPE } from './http-utils';

const router = express.Router();

router.get('/video/:chatId/:messageId', async (req: Request, res: Response) => {
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  try {
    const { message, size, mimeType, fileName } = await getVideoMessage(req.params.chatId, req.params.messageId);

    const range = parseRange(req.headers.range, size);
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const contentLength = end - start + 1;

    const safeMimeType = SAFE_MIME_TYPE.test(mimeType) ? mimeType : 'application/octet-stream';
    const disposition = safeMimeType === 'application/octet-stream' ? 'attachment' : 'inline';

    res.status(range ? 206 : 200);
    res.set({
      'Content-Type': safeMimeType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(contentLength),
      'Content-Disposition': buildContentDisposition(disposition, fileName),
    });
    if (range) {
      res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    const iterator = client.iterDownload({
      file: message.media,
      offset: bigInt(start),
      limit: contentLength,
      requestSize: CHUNK_SIZE,
    });

    for await (const chunk of iterator) {
      if (aborted) break;
      const canContinue = res.write(chunk);
      if (!canContinue) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }

    if (!aborted) res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(404).json({ error: (err as Error).message });
    } else {
      res.end();
    }
  }
});

export = router;
