import { client, getVideoMessage } from '@/telegram-client';
import bigInt from 'big-integer';
import type { Request, Response } from 'express';
import { buildContentDisposition, CHUNK_SIZE, parseRange, SAFE_MIME_TYPE } from './video-response';

type StreamDisposition = 'inline' | 'attachment';

export async function streamTelegramVideo(
  req: Request,
  res: Response,
  { disposition }: { disposition: StreamDisposition },
): Promise<void> {
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

    // `limit` do iterDownload é a quantidade de chunks de `requestSize` bytes a
    // buscar, não uma contagem de bytes — passar `contentLength` (bytes) direto
    // fazia o download continuar muito além da janela pedida, escrevendo mais
    // bytes na resposta do que o `Content-Length` declarado (só não quebrava a
    // requisição completa, sem Range, porque `contentLength` ali já é o
    // tamanho real do arquivo). O corte explícito abaixo garante que nunca
    // escrevemos além do que foi declarado, mesmo se o último chunk do
    // Telegram ultrapassar a janela.
    const chunkCount = Math.ceil(contentLength / CHUNK_SIZE);
    const iterator = client.iterDownload({
      file: message.media,
      offset: bigInt(start),
      limit: chunkCount,
      requestSize: CHUNK_SIZE,
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
