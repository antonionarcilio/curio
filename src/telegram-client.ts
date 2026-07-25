import pLimit from 'p-limit';
import { Api, TelegramClient } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';
import { StringSession } from 'telegram/sessions';
import config from './config';
import { probeVideoMetadata } from './services/videos/probe';
import { clearAllCaches, withCache } from './utils/ttl-cache';

const client = new TelegramClient(new StringSession(config.session), config.apiId, config.apiHash, {
  connectionRetries: 5,
});

let connected = false;

async function ensureConnected(): Promise<TelegramClient> {
  if (!connected) {
    await client.connect();
    connected = true;
  }
  return client;
}

type VideoDocument = {
  document: Api.Document;
  size: number;
  mimeType: string;
  fileName: string;
};

type VideoListItem = {
  message_id: number;
  file_name: string;
  size: number;
  mime_type: string;
  date: number;
};

type VideoAttributes = {
  duration: number | null;
  width: number | null;
  height: number | null;
  supports_streaming: boolean;
};

type ThumbnailInfo = {
  thumbnail_width: number | null;
  thumbnail_height: number | null;
  thumbnail: string | null;
};

// Item rico usado pela listagem de vídeos por peer: tudo aqui sai do mesmo
// Api.Document que já vem na mensagem, sem chamada extra ao Telegram.
type ChannelVideoItem = VideoListItem & VideoAttributes & ThumbnailInfo & { description: string | null };

type VideoListEntry = {
  chat_id: string;
  chat_title: string;
  message_id: number;
  file_name: string;
  size: number;
  mime_type: string;
  date: number;
  description: string | null;
};

// /channels só lida com peers do tipo Channel (GramJS: dialog.isChannel), por
// isso usa channel_id/channel_title.
type ChannelListEntry = {
  channel_id: string;
  channel_title: string;
};

type VideoFetchParams = { limit: number; offset: number };

type VideoFetchResult = { items: ChannelVideoItem[]; total: number };

type ChannelVideosResult = {
  channel_id: string;
  channel_title: string;
  items: ChannelVideoItem[];
  total: number;
};

type VideoThumbnail = ThumbnailInfo & { thumbnail: string };

type VideoMessageResult = VideoDocument & { message: Api.Message };

type Dialog = Awaited<ReturnType<TelegramClient['getDialogs']>>[number];

// O filtro `InputMessagesFilterVideo` na busca já garante que só documentos de
// vídeo chegam aqui (exclui video-notes e GIFs, que têm filtros próprios) —
// esta função só extrai os metadados do documento, não decide mais "é vídeo?".
function extractVideoDocument(message: Api.Message): VideoDocument | null {
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

// Só PhotoSize carrega w/h; PhotoStrippedSize/PhotoCachedSize não têm dimensões
// declaradas no schema do MTProto, então não servem pra thumbnail_width/height.
function findLargestPhotoSize(thumbs: Api.TypePhotoSize[]): Api.PhotoSize | undefined {
  return thumbs
    .filter((thumb): thumb is Api.PhotoSize => thumb.className === 'PhotoSize')
    .reduce<Api.PhotoSize | undefined>(
      (largest, thumb) => (!largest || thumb.w > largest.w ? thumb : largest),
      undefined,
    );
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

function toJpegDataUri(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
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

// GramJS só resolve um chatId numérico bruto pra getMessages/getEntity se o
// access_hash correspondente já estiver no cache interno de entidades — e esse
// cache só é populado como efeito colateral de getDialogs(). Sem isso, a
// primeira chamada a uma rota de canal/chat específico falha com
// "Could not find the input entity" até que uma rota como /api/v1/videos/grouped
// ou /api/v1/channels rode uma vez
// (eles chamam getDialogs). Esta função replica esse aquecimento sob demanda.
async function resolveEntityUncached(chatId: string): Promise<unknown> {
  const tg = await ensureConnected();
  try {
    return await tg.getEntity(chatId);
  } catch {
    await tg.getDialogs({});
    try {
      return await tg.getEntity(chatId);
    } catch (error) {
      throw new Error(
        `Não foi possível resolver a entidade do Telegram para chatId "${chatId}" ` +
          `(esperado: id numérico, "me", ou @username de um chat/canal já conhecido pela conta). ` +
          `Detalhe original: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }
}

const resolveEntity = withCache(config.cacheTtlMs, (chatId: string) => chatId, resolveEntityUncached);

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

const getVideoMessage = withCache(
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

const getVideoThumbnail = withCache(
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

const listVideos = withCache(
  config.cacheTtlMs,
  (chatId: string, { limit, offset }: VideoFetchParams) => `${chatId}:${limit}:${offset}`,
  listVideosUncached,
);

async function listChannelsUncached(limit: number): Promise<ChannelListEntry[]> {
  const tg = await ensureConnected();
  const dialogs = await tg.getDialogs({ limit });

  return dialogs
    .filter((dialog) => dialog.isChannel)
    .map((dialog) => ({
      channel_id: (dialog.id ?? '').toString(),
      channel_title: dialog.title || dialog.name || (dialog.id ?? '').toString(),
    }));
}

const listChannels = withCache(config.cacheTtlMs, (limit: number) => `${limit}`, listChannelsUncached);

async function getChannelVideosUncached(chatId: string, params: VideoFetchParams): Promise<ChannelVideosResult> {
  const entity = (await resolveEntity(chatId)) as { title?: string; username?: string };
  const channelTitle = ('title' in entity && entity.title) || ('username' in entity && entity.username) || chatId;
  const { items, total } = await listVideos(chatId, params);

  return { channel_id: chatId.toString(), channel_title: channelTitle, items, total };
}

const getChannelVideos = withCache(
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

const listAllVideos = withCache(
  config.cacheTtlMs,
  ({ perChatLimit = 100 }: { perChatLimit?: number } = {}) => `${perChatLimit}`,
  listAllVideosUncached,
);

type UploadVideoParams = {
  buffer: Buffer;
  originalFileName: string;
  description?: string;
  thumbnailBuffer?: Buffer;
  onProgress?: (progress: number) => void;
};

// Mesmo teto que o próprio Telegram aplica a contas normais. sendFile's
// uploadFile interno só troca pra ler de disco (`file.path`) acima de
// ~20MB — como o upload inteiro já vive em memória (multer memoryStorage,
// sem path real), qualquer vídeo nessa faixa quebraria com "Either one of
// `buffer` or `filePath` should be specified" se não forçássemos o buffer
// path explicitamente via `maxBufferSize` abaixo.
const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

// editMessage do Telegram só troca os bytes do arquivo (file/forceDocument),
// nunca nome/thumbnail (attributes/thumb) — por isso thumbnail customizado só
// é possível no upload, via sendFile, nunca numa edição de mensagem existente
// (ver CLAUDE.md/docs/ROUTES.md para o motivo).
async function uploadVideo(chatId: string, params: UploadVideoParams): Promise<VideoListItem> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  const file = new CustomFile(params.originalFileName, params.buffer.length, '', params.buffer);

  // Faz o upload dos bytes nós mesmos (em vez de deixar o sendFile decidir)
  // pra poder passar um `maxBufferSize` generoso — sem isso, qualquer arquivo
  // acima de ~20MB cairia no branch de leitura por `file.path`, que é sempre
  // vazio aqui (tudo em memória). O handle resultante (Api.InputFile ou
  // InputFileBig) é reconhecido diretamente por sendFile, que pula a etapa de
  // upload e só monta a mensagem.
  const uploadedFile = await tg.uploadFile({
    file,
    workers: 1,
    maxBufferSize: MAX_UPLOAD_SIZE_BYTES,
    onProgress: params.onProgress,
  });

  const attributes: Api.TypeDocumentAttribute[] = [
    new Api.DocumentAttributeFilename({ fileName: params.originalFileName }),
  ];

  // A versão instalada de `telegram` nunca detecta duration/width/height reais
  // (getAttributes usa um `_getMetadata` que é só um stub) — sem isso, todo
  // vídeo enviado fica com duration 0. Passar nosso próprio
  // DocumentAttributeVideo aqui sobrescreve o (quebrado) auto-detect do
  // GramJS; se o ffprobe falhar/não estiver disponível, o upload segue sem
  // esse atributo em vez de falhar.
  const probed = await probeVideoMetadata(params.buffer);
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
    // branch de thumb em _fileToMedia (telegram@2.26.22) não checa
    // `instanceof CustomFile`, só `Buffer.isBuffer`, e falha com "Could not
    // create file from [object Object]" se receber um CustomFile aqui.
    thumb: params.thumbnailBuffer,
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

async function editVideoCaption(chatId: string, messageId: string | number, description: string): Promise<void> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  await tg.editMessage(chatId, { message: Number(messageId), text: description });
  clearAllCaches();
}

async function deleteVideoMessage(chatId: string, messageId: string | number): Promise<void> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  await tg.deleteMessages(chatId, [Number(messageId)], { revoke: true });
  clearAllCaches();
}

export {
  client,
  deleteVideoMessage,
  editVideoCaption,
  ensureConnected,
  getChannelVideos,
  getVideoMessage,
  getVideoThumbnail,
  listAllVideos,
  listChannels,
  listVideos,
  MAX_UPLOAD_SIZE_BYTES,
  uploadVideo,
};
export type { ChannelVideoItem, VideoFetchParams, VideoListEntry, VideoListItem, VideoThumbnail };
