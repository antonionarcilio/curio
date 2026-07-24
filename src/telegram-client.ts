import pLimit from 'p-limit';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { withCache } from './cache/ttl-cache';
import config from './config';

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

type VideoListEntry = {
  chat_id: string;
  chat_title: string;
  message_id: number;
  file_name: string;
  size: number;
  mime_type: string;
  date: number;
};

// /channels e /channels/:chatId/videos só lidam com peers do tipo Channel
// (GramJS: dialog.isChannel) — por isso usam channel_id/channel_title, e não
// chat_id/chat_title (esse último é reservado pra rotas que podem apontar
// pra qualquer tipo de diálogo: grupo comum, chat privado, "me").
type ChannelListEntry = {
  channel_id: string;
  channel_title: string;
};

type VideoFetchParams = { limit: number; offset: number };

type VideoFetchResult = { items: VideoListItem[]; total: number };

type ChannelVideosResult = {
  channel_id: string;
  channel_title: string;
  items: VideoListItem[];
  total: number;
};

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

async function getVideoMessageUncached(chatId: string, messageId: string | number): Promise<VideoMessageResult> {
  const tg = await ensureConnected();
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

async function listVideosUncached(chatId: string, { limit, offset }: VideoFetchParams): Promise<VideoFetchResult> {
  const tg = await ensureConnected();
  const messages = await tg.getMessages(chatId, {
    filter: new Api.InputMessagesFilterVideo(),
    limit,
    addOffset: offset,
  });

  const items: VideoListItem[] = [];
  for (const message of messages) {
    const video = extractVideoDocument(message);
    if (!video) continue;
    items.push({
      message_id: message.id,
      file_name: video.fileName,
      size: video.size,
      mime_type: video.mimeType,
      date: message.date,
    });
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
  const tg = await ensureConnected();
  const entity = await tg.getEntity(chatId);
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

export { client, ensureConnected, getChannelVideos, getVideoMessage, listAllVideos, listChannels, listVideos };
export type { VideoFetchParams, VideoListEntry, VideoListItem };
