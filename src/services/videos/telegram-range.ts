import { CHUNK_SIZE } from '@/utils/http-response';
import bigInt from 'big-integer';
import { Api, type TelegramClient } from 'teleproto';

type TelegramRangeParams = {
  client: TelegramClient;
  document: Api.Document;
  start: number;
  contentLength: number;
  signal?: AbortSignal;
};

function inputLocationFromDocument(document: Api.Document): Api.InputDocumentFileLocation {
  return new Api.InputDocumentFileLocation({
    id: document.id,
    accessHash: document.accessHash,
    fileReference: document.fileReference,
    thumbSize: '',
  });
}

export async function* iterTelegramDocumentRange({
  client,
  document,
  start,
  contentLength,
  signal,
}: TelegramRangeParams): AsyncGenerator<Buffer> {
  const location = inputLocationFromDocument(document);
  let offset = start;
  let remaining = contentLength;

  while (remaining > 0) {
    if (signal?.aborted) break;

    const alignedOffset = Math.floor(offset / CHUNK_SIZE) * CHUNK_SIZE;
    const skip = offset - alignedOffset;
    const bytes = await client._media.getFile(document.dcId, location, bigInt(alignedOffset), CHUNK_SIZE, signal);
    if (bytes.length === 0) break;

    const available = bytes.subarray(skip);
    const chunk = available.length > remaining ? available.subarray(0, remaining) : available;
    if (chunk.length === 0) break;

    yield chunk;

    offset += chunk.length;
    remaining -= chunk.length;
  }
}
