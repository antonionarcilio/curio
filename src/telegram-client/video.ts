import config from '@/config';
import { probeVideoMetadata } from '@/services/videos/probe';
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

export type VideoDocument = {
  document: Api.Document;
  size: number;
  mimeType: string;
  fileName: string;
};

export type VideoListItem = {
  message_id: number;
  file_name: string;
  size: number;
  mime_type: string;
  date: number;
};

export type VideoAttributes = {
  duration: number | null;
  width: number | null;
  height: number | null;
  supports_streaming: boolean;
};

// Item rico usado pela listagem de vídeos por peer: tudo aqui sai do mesmo
// Api.Document que já vem na mensagem, sem chamada extra ao Telegram.
export type ChannelVideoItem = VideoListItem & VideoAttributes & ThumbnailInfo & { description: string | null };

export type VideoListEntry = {
  chat_id: string;
  chat_title: string;
  message_id: number;
  file_name: string;
  size: number;
  mime_type: string;
  date: number;
  description: string | null;
};

export type VideoFetchParams = MediaFetchParams;

export type VideoFetchResult = { items: ChannelVideoItem[]; total: number };

export type ChannelVideosResult = {
  channel_id: string;
  channel_title: string;
  items: ChannelVideoItem[];
  total: number;
};

export type VideoThumbnail = ThumbnailInfo & { thumbnail: string };

export type VideoMessageResult = VideoDocument & { message: Api.Message };

// O filtro `InputMessagesFilterVideo` na busca já garante que só documentos de
// vídeo chegam aqui (exclui video-notes e GIFs, que têm filtros próprios) —
// esta função só extrai os metadados do documento, não decide mais "é vídeo?".
export function extractVideoDocument(message: Api.Message): VideoDocument | null {
  const media = message.media;
  const document = media && 'document' in media ? (media.document as Api.Document | undefined) : undefined;
  if (!document || !('mimeType' in document)) return null;

  const nameAttr = document.attributes?.find((attr) => attr.className === 'DocumentAttributeFilename') as
    Api.DocumentAttributeFilename | undefined;

  return {
    document,
    size: Number(document.size),
    mimeType: document.mimeType || 'video/mp4',
    fileName: nameAttr?.fileName || `${message.id}.mp4`,
  };
}

function extractVideoAttributes(document: Api.Document): VideoAttributes {
  const videoAttribute = document.attributes?.find((attribute) => attribute.className === 'DocumentAttributeVideo') as
    Api.DocumentAttributeVideo | undefined;

  return {
    duration: videoAttribute ? Math.round(videoAttribute.duration) : null,
    width: videoAttribute?.w ?? null,
    height: videoAttribute?.h ?? null,
    supports_streaming: videoAttribute?.supportsStreaming ?? false,
  };
}

// thumbnail_width/height são de graça (só leem o Api.Document que já veio na
// mensagem). Os bytes de `thumbnail`, porém, exigem um download por vídeo —
// por isso ficam null aqui e só são preenchidos por getVideoThumbnail, quando
// a rota pede explicitamente via ?thumbnail=true.
function extractThumbnailInfo(document: Api.Document): ThumbnailInfo {
  const largest = findLargestPhotoSize(document.thumbs ?? []);

  return {
    thumbnail_width: largest?.w ?? null,
    thumbnail_height: largest?.h ?? null,
    thumbnail: null,
  };
}

function buildChannelVideoItem(message: Api.Message, video: VideoDocument): ChannelVideoItem {
  return {
    message_id: message.id,
    file_name: video.fileName,
    size: video.size,
    mime_type: video.mimeType,
    date: message.date,
    description: message.message || null,
    ...extractVideoAttributes(video.document),
    ...extractThumbnailInfo(video.document),
  };
}

async function getVideoMessageUncached(chatId: string, messageId: string | number): Promise<VideoMessageResult> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  const messages = await tg.getMessages(chatId, { ids: [Number(messageId)] });
  const message = messages[0];
  if (!message) {
    throw new Error('Mensagem não encontrada');
  }

  const video = extractVideoDocument(message);
  if (!video) {
    throw new Error('Mensagem não contém um vídeo');
  }

  return { message, ...video };
}

export const getVideoMessage = withCache(
  config.cacheTtlMs,
  (chatId: string, messageId: string | number) => `${chatId}:${messageId}`,
  getVideoMessageUncached,
);

// Ao contrário do preview stripped (que vem de graça na mensagem), aqui os
// bytes da thumbnail real são baixados do Telegram — uma chamada por vídeo, por
// isso é opt-in via ?thumbnail=full e passa pelo cache TTL.
async function getVideoThumbnailUncached(chatId: string, messageId: string | number): Promise<VideoThumbnail> {
  const { message, document } = await getVideoMessage(chatId, messageId);
  const largest = findLargestPhotoSize(document.thumbs ?? []);
  if (!largest) {
    throw new Error(
      `Vídeo ${chatId}:${messageId} não tem thumbnail baixável ` +
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

export const getVideoThumbnail = withCache(
  config.cacheTtlMs,
  (chatId: string, messageId: string | number) => `${chatId}:${messageId}`,
  getVideoThumbnailUncached,
);

async function listVideosUncached(chatId: string, { limit, offset }: VideoFetchParams): Promise<VideoFetchResult> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  const messages = await tg.getMessages(chatId, {
    filter: new Api.InputMessagesFilterVideo(),
    limit,
    addOffset: offset,
  });

  const items: ChannelVideoItem[] = [];
  for (const message of messages) {
    const video = extractVideoDocument(message);
    if (!video) continue;
    items.push(buildChannelVideoItem(message, video));
  }

  return { items, total: messages.total ?? items.length };
}

export const listVideos = withCache(
  config.cacheTtlMs,
  (chatId: string, { limit, offset }: VideoFetchParams) => `${chatId}:${limit}:${offset}`,
  listVideosUncached,
);

async function getChannelVideosUncached(chatId: string, params: VideoFetchParams): Promise<ChannelVideosResult> {
  const entity = (await resolveEntity(chatId)) as { title?: string; username?: string };
  const channelTitle = ('title' in entity && entity.title) || ('username' in entity && entity.username) || chatId;
  const { items, total } = await listVideos(chatId, params);

  return { channel_id: chatId.toString(), channel_title: channelTitle, items, total };
}

export const getChannelVideos = withCache(
  config.cacheTtlMs,
  (chatId: string, { limit, offset }: VideoFetchParams) => `${chatId}:${limit}:${offset}`,
  getChannelVideosUncached,
);

async function fetchDialogVideos(tg: TelegramClient, dialog: Dialog, perChatLimit: number): Promise<VideoListEntry[]> {
  const chatId = dialog.id;
  if (!chatId) return [];

  let messages;
  try {
    messages = await tg.getMessages(chatId, {
      filter: new Api.InputMessagesFilterVideo(),
      limit: perChatLimit,
    });
  } catch {
    return [];
  }

  const videos: VideoListEntry[] = [];
  for (const message of messages) {
    const video = extractVideoDocument(message);
    if (!video) continue;
    videos.push({
      chat_id: chatId.toString(),
      chat_title: dialog.title || dialog.name || chatId.toString(),
      message_id: message.id,
      file_name: video.fileName,
      size: video.size,
      mime_type: video.mimeType,
      date: message.date,
      description: message.message || null,
    });
  }

  return videos;
}

async function listAllVideosUncached({ perChatLimit = 100 }: { perChatLimit?: number } = {}): Promise<
  VideoListEntry[]
> {
  const tg = await ensureConnected();
  const dialogs = await tg.getDialogs({});

  const limit = pLimit(config.fetchConcurrency);
  const perDialog = await Promise.all(
    dialogs.map((dialog) => limit(() => fetchDialogVideos(tg, dialog, perChatLimit))),
  );

  return perDialog.flat();
}

export const listAllVideos = withCache(
  config.cacheTtlMs,
  ({ perChatLimit = 100 }: { perChatLimit?: number } = {}) => `${perChatLimit}`,
  listAllVideosUncached,
);

export type UploadVideoParams = {
  videoPath: string;
  videoSize: number;
  originalFileName: string;
  maxUploadSizeBytes?: number;
  description?: string;
  thumbnailPath?: string;
  onProgress?: (progress: number) => void;
};

export async function uploadVideo(chatId: string, params: UploadVideoParams): Promise<VideoListItem> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  const file = new CustomFile(params.originalFileName, params.videoSize, params.videoPath);

  // `CustomFile` recebe um caminho seekable: o TeleProto lê o vídeo em blocos
  // do disco, sem manter o upload inteiro na memória. O handle resultante
  // (Api.InputFile ou InputFileBig) é reconhecido diretamente por sendFile,
  // que pula a etapa de upload e só monta a mensagem.
  const uploadedFile = await tg.uploadFile({
    file,
    workers: 1,
    maxBufferSize: params.maxUploadSizeBytes ?? STANDARD_MAX_UPLOAD_SIZE_BYTES,
    onProgress: params.onProgress,
  });

  const attributes: Api.TypeDocumentAttribute[] = [
    new Api.DocumentAttributeFilename({ fileName: params.originalFileName }),
  ];

  // A versão instalada de `telegram` nunca detecta duration/width/height reais
  // (getAttributes usa um `_getMetadata` que é só um stub) — sem isso, todo
  // vídeo enviado fica com duration 0. Passar nosso próprio
  // DocumentAttributeVideo aqui sobrescreve o (quebrado) auto-detect do
  // TeleProto; se o ffprobe falhar/não estiver disponível, o upload segue sem
  // esse atributo em vez de falhar.
  const probed = await probeVideoMetadata(params.videoPath);
  if (probed) {
    attributes.push(
      new Api.DocumentAttributeVideo({
        duration: probed.duration,
        w: probed.width,
        h: probed.height,
        supportsStreaming: true,
      }),
    );
  }

  const message = await tg.sendFile(chatId, {
    file: uploadedFile,
    // sendFile's runtime só reconhece Buffer cru (ou path/File) pra `thumb` —
    // ao contrário do parâmetro `file`, que aceita CustomFile diretamente, o
    // branch de thumb em _fileToMedia (teleproto@1.228.4) não checa
    // `instanceof CustomFile`, só `Buffer.isBuffer`, e falha com "Could not
    // create file from [object Object]" se receber um CustomFile aqui.
    thumb: params.thumbnailPath ? await fs.readFile(params.thumbnailPath) : undefined,
    caption: params.description,
    attributes,
    forceDocument: false,
    supportsStreaming: true,
  });

  const video = extractVideoDocument(message);
  if (!video) {
    throw new Error('Falha ao processar o vídeo enviado');
  }

  clearAllCaches();

  return {
    message_id: message.id,
    file_name: video.fileName,
    size: video.size,
    mime_type: video.mimeType,
    date: message.date,
  };
}
