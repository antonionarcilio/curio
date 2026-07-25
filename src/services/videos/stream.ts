import { client, getVideoMessage } from '@/telegram-client';
import { buildContentDisposition, parseRange, SAFE_MIME_TYPE } from '@/utils/http-response';
import type { Request, Response } from 'express';
import { iterTelegramDocumentRange } from './telegram-range';

type StreamDisposition = 'inline' | 'attachment';

export async function streamTelegramVideo(
  req: Request,
  res: Response,
  { disposition }: { disposition: StreamDisposition },
): Promise<void> {
  let aborted = false;
  const abortController = new AbortController();
  req.on('close', () => {
    aborted = true;
    abortController.abort();
  });

  try {
    const { document, size, mimeType, fileName } = await getVideoMessage(req.params.chatId, req.params.messageId);

    const range = parseRange(req.headers.range, size);
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const contentLength = end - start + 1;

    const safeMimeType = SAFE_MIME_TYPE.test(mimeType) ? mimeType : 'application/octet-stream';
    const contentDisposition =
      disposition === 'attachment' || safeMimeType === 'application/octet-stream' ? 'attachment' : 'inline';

    res.status(range ? 206 : 200);
    res.set({
      'Content-Type': safeMimeType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(contentLength),
      'Content-Disposition': buildContentDisposition(contentDisposition, fileName),
    });
    if (range) {
      res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    const iterator = iterTelegramDocumentRange({
      client,
      document,
      start,
      contentLength,
      signal: abortController.signal,
    });

    let bytesWritten = 0;
    for await (const chunk of iterator) {
      if (aborted || bytesWritten >= contentLength) break;
      const remaining = contentLength - bytesWritten;
      const toWrite = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      bytesWritten += toWrite.length;

      const canContinue = res.write(toWrite);
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
}
