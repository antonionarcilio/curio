import config from '@/config';
import { probeAudioMetadata } from '@/services/audios/probe';
import { clearAllCaches, withCache } from '@/utils/ttl-cache';
import fs from 'fs/promises';
import pLimit from 'p-limit';
import { Api, type TelegramClient } from 'teleproto';
import { CustomFile } from 'teleproto/client/uploads';
import {
  client,
  ensureConnected,
  findLargestPhotoSize,
  resolveEntity,
  STANDARD_MAX_UPLOAD_SIZE_BYTES,
  toJpegDataUri,
  type Dialog,
  type MediaFetchParams,
  type ThumbnailInfo,
} from './shared';

export type AudioDocument = {
  document: Api.Document;
  size: number;
  mimeType: string;
  fileName: string;
};

export type AudioListItem = {
  message_id: number;
  file_name: string;
  size: number;
  mime_type: string;
  date: number;
};

export type AudioAttributes = {
  duration: number | null;
  title: string | null;
  performer: string | null;
};

// Item rico usado pela listagem de áudios por peer: tudo aqui sai do mesmo
// Api.Document que já vem na mensagem, sem chamada extra ao Telegram.
export type ChannelAudioItem = AudioListItem & AudioAttributes & ThumbnailInfo & { description: string | null };

export type AudioListEntry = {
  chat_id: string;
  chat_title: string;
  message_id: number;
  file_name: string;
  size: number;
  mime_type: string;
  date: number;
  description: string | null;
};

export type AudioFetchParams = MediaFetchParams;

export type AudioFetchResult = { items: ChannelAudioItem[]; total: number };

export type ChannelAudiosResult = {
  channel_id: string;
  channel_title: string;
  items: ChannelAudioItem[];
  total: number;
};

export type AudioThumbnail = ThumbnailInfo & { thumbnail: string };

export type AudioMessageResult = AudioDocument & { message: Api.Message };

// O filtro `InputMessagesFilterMusic` na busca já garante que só arquivos de
// música/áudio chegam aqui (exclui voice notes, que têm filtro próprio,
// InputMessagesFilterVoice) — esta função só extrai os metadados do
// documento. Ainda assim descarta defensivamente um documento cujo
// DocumentAttributeAudio.voice seja true, como segunda camada de proteção
// contra uma eventual inconsistência do filtro nativo do Telegram.
export function extractAudioDocument(message: Api.Message): AudioDocument | null {
  const media = message.media;
  const document = media && 'document' in media ? (media.document as Api.Document | undefined) : undefined;
  if (!document || !('mimeType' in document)) return null;

  const audioAttribute = document.attributes?.find((attr) => attr.className === 'DocumentAttributeAudio') as
    Api.DocumentAttributeAudio | undefined;
  if (audioAttribute?.voice) return null;

  const nameAttr = document.attributes?.find((attr) => attr.className === 'DocumentAttributeFilename') as
    Api.DocumentAttributeFilename | undefined;

  return {
    document,
    size: Number(document.size),
    mimeType: document.mimeType || 'audio/mpeg',
    fileName: nameAttr?.fileName || `${message.id}.mp3`,
  };
}

function extractAudioAttributes(document: Api.Document): AudioAttributes {
  const audioAttribute = document.attributes?.find((attribute) => attribute.className === 'DocumentAttributeAudio') as
    Api.DocumentAttributeAudio | undefined;

  return {
    duration: audioAttribute ? Math.round(audioAttribute.duration) : null,
    title: audioAttribute?.title ?? null,
    performer: audioAttribute?.performer ?? null,
  };
}

// thumbnail_width/height são de graça (só leem o Api.Document que já veio na
// mensagem, ex: capa de álbum). Os bytes de `thumbnail`, porém, exigem um
// download por áudio — por isso ficam null aqui e só são preenchidos por
// getAudioThumbnail, quando a rota pede explicitamente via ?thumbnail=true.
function extractThumbnailInfo(document: Api.Document): ThumbnailInfo {
  const largest = findLargestPhotoSize(document.thumbs ?? []);

  return {
    thumbnail_width: largest?.w ?? null,
    thumbnail_height: largest?.h ?? null,
    thumbnail: null,
  };
}

function buildChannelAudioItem(message: Api.Message, audio: AudioDocument): ChannelAudioItem {
  return {
    message_id: message.id,
    file_name: audio.fileName,
    size: audio.size,
    mime_type: audio.mimeType,
    date: message.date,
    description: message.message || null,
    ...extractAudioAttributes(audio.document),
    ...extractThumbnailInfo(audio.document),
  };
}

async function getAudioMessageUncached(chatId: string, messageId: string | number): Promise<AudioMessageResult> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  const messages = await tg.getMessages(chatId, { ids: [Number(messageId)] });
  const message = messages[0];
  if (!message) {
    throw new Error('Mensagem não encontrada');
  }

  const audio = extractAudioDocument(message);
  if (!audio) {
    throw new Error('Mensagem não contém um áudio');
  }

  return { message, ...audio };
}

export const getAudioMessage = withCache(
  config.cacheTtlMs,
  (chatId: string, messageId: string | number) => `${chatId}:${messageId}`,
  getAudioMessageUncached,
);

// Ao contrário do preview stripped (que vem de graça na mensagem), aqui os
// bytes da thumbnail real são baixados do Telegram — uma chamada por áudio, por
// isso é opt-in via ?thumbnail=true e passa pelo cache TTL.
async function getAudioThumbnailUncached(chatId: string, messageId: string | number): Promise<AudioThumbnail> {
  const { message, document } = await getAudioMessage(chatId, messageId);
  const largest = findLargestPhotoSize(document.thumbs ?? []);
  if (!largest) {
    throw new Error(
      `Áudio ${chatId}:${messageId} não tem thumbnail baixável ` +
        `(esperado: pelo menos um Api.PhotoSize em document.thumbs, recebido: ${document.thumbs?.length ?? 0} thumb(s))`,
    );
  }

  const bytes = await client.downloadMedia(message, { thumb: largest });
  if (!bytes || typeof bytes === 'string') {
    throw new Error(
      `downloadMedia não retornou os bytes da thumbnail de ${chatId}:${messageId} ` +
        `(esperado: Buffer, recebido: ${typeof bytes})`,
    );
  }

  return {
    thumbnail: toJpegDataUri(Buffer.from(bytes)),
    thumbnail_width: largest.w,
    thumbnail_height: largest.h,
  };
}

export const getAudioThumbnail = withCache(
  config.cacheTtlMs,
  (chatId: string, messageId: string | number) => `${chatId}:${messageId}`,
  getAudioThumbnailUncached,
);

async function listAudiosUncached(chatId: string, { limit, offset }: AudioFetchParams): Promise<AudioFetchResult> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  const messages = await tg.getMessages(chatId, {
    filter: new Api.InputMessagesFilterMusic(),
    limit,
    addOffset: offset,
  });

  const items: ChannelAudioItem[] = [];
  for (const message of messages) {
    const audio = extractAudioDocument(message);
    if (!audio) continue;
    items.push(buildChannelAudioItem(message, audio));
  }

  return { items, total: messages.total ?? items.length };
}

export const listAudios = withCache(
  config.cacheTtlMs,
  (chatId: string, { limit, offset }: AudioFetchParams) => `${chatId}:${limit}:${offset}`,
  listAudiosUncached,
);

async function getChannelAudiosUncached(chatId: string, params: AudioFetchParams): Promise<ChannelAudiosResult> {
  const entity = (await resolveEntity(chatId)) as { title?: string; username?: string };
  const channelTitle = ('title' in entity && entity.title) || ('username' in entity && entity.username) || chatId;
  const { items, total } = await listAudios(chatId, params);

  return { channel_id: chatId.toString(), channel_title: channelTitle, items, total };
}

export const getChannelAudios = withCache(
  config.cacheTtlMs,
  (chatId: string, { limit, offset }: AudioFetchParams) => `${chatId}:${limit}:${offset}`,
  getChannelAudiosUncached,
);

async function fetchDialogAudios(tg: TelegramClient, dialog: Dialog, perChatLimit: number): Promise<AudioListEntry[]> {
  const chatId = dialog.id;
  if (!chatId) return [];

  let messages;
  try {
    messages = await tg.getMessages(chatId, {
      filter: new Api.InputMessagesFilterMusic(),
      limit: perChatLimit,
    });
  } catch {
    return [];
  }

  const audios: AudioListEntry[] = [];
  for (const message of messages) {
    const audio = extractAudioDocument(message);
    if (!audio) continue;
    audios.push({
      chat_id: chatId.toString(),
      chat_title: dialog.title || dialog.name || chatId.toString(),
      message_id: message.id,
      file_name: audio.fileName,
      size: audio.size,
      mime_type: audio.mimeType,
      date: message.date,
      description: message.message || null,
    });
  }

  return audios;
}

async function listAllAudiosUncached({ perChatLimit = 100 }: { perChatLimit?: number } = {}): Promise<
  AudioListEntry[]
> {
  const tg = await ensureConnected();
  const dialogs = await tg.getDialogs({});

  const limit = pLimit(config.fetchConcurrency);
  const perDialog = await Promise.all(
    dialogs.map((dialog) => limit(() => fetchDialogAudios(tg, dialog, perChatLimit))),
  );

  return perDialog.flat();
}

export const listAllAudios = withCache(
  config.cacheTtlMs,
  ({ perChatLimit = 100 }: { perChatLimit?: number } = {}) => `${perChatLimit}`,
  listAllAudiosUncached,
);

export type UploadAudioParams = {
  audioPath: string;
  audioSize: number;
  originalFileName: string;
  maxUploadSizeBytes?: number;
  description?: string;
  thumbnailPath?: string;
  onProgress?: (progress: number) => void;
};

function buildAudioUploadAttributes(
  originalFileName: string,
  probed: Awaited<ReturnType<typeof probeAudioMetadata>>,
): Api.TypeDocumentAttribute[] {
  const attributes: Api.TypeDocumentAttribute[] = [new Api.DocumentAttributeFilename({ fileName: originalFileName })];

  if (probed) {
    attributes.push(
      new Api.DocumentAttributeAudio({
        duration: probed.duration,
        title: probed.title ?? undefined,
        performer: probed.performer ?? undefined,
      }),
    );
  }

  return attributes;
}

async function sendAudioMessage(
  chatId: string,
  uploadedFile: Awaited<ReturnType<TelegramClient['uploadFile']>>,
  attributes: Api.TypeDocumentAttribute[],
  description: string | undefined,
  thumbnailPath: string | undefined,
): Promise<Api.Message> {
  const tg = await ensureConnected();
  // Sem forceDocument: false o Telegram trata o anexo como um documento
  // genérico, sem o player de música nativo (título/artista visíveis no
  // cliente). Ao contrário de vídeo, não há `supportsStreaming` — esse flag
  // não existe para DocumentAttributeAudio.
  return tg.sendFile(chatId, {
    file: uploadedFile,
    // Capa de álbum: o branch de `thumb` em _fileToMedia (teleproto) não checa
    // `instanceof CustomFile`, só `Buffer.isBuffer`, e falha com "Could not
    // create file from [object Object]" se receber outra coisa — por isso o
    // arquivo é lido como Buffer cru aqui, igual ao upload de vídeo.
    thumb: thumbnailPath ? await fs.readFile(thumbnailPath) : undefined,
    caption: description,
    attributes,
    forceDocument: false,
  });
}

export async function uploadAudio(chatId: string, params: UploadAudioParams): Promise<AudioListItem> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  const file = new CustomFile(params.originalFileName, params.audioSize, params.audioPath);

  const uploadedFile = await tg.uploadFile({
    file,
    workers: 1,
    maxBufferSize: params.maxUploadSizeBytes ?? STANDARD_MAX_UPLOAD_SIZE_BYTES,
    onProgress: params.onProgress,
  });

  // A versão instalada de `telegram` nunca detecta metadados reais de áudio —
  // sem um DocumentAttributeAudio explícito o upload sai com duration 0 e sem
  // título/artista; se o ffprobe falhar/não estiver disponível, o upload
  // segue sem esse atributo em vez de falhar.
  const probed = await probeAudioMetadata(params.audioPath);
  const attributes = buildAudioUploadAttributes(params.originalFileName, probed);
  const message = await sendAudioMessage(chatId, uploadedFile, attributes, params.description, params.thumbnailPath);

  const audio = extractAudioDocument(message);
  if (!audio) {
    throw new Error('Falha ao processar o áudio enviado');
  }

  clearAllCaches();

  return {
    message_id: message.id,
    file_name: audio.fileName,
    size: audio.size,
    mime_type: audio.mimeType,
    date: message.date,
  };
}
