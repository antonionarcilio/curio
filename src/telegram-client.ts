import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
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

function extractVideoDocument(message: Api.Message): VideoDocument | null {
  const media = message.media;
  const document = media && 'document' in media ? (media.document as Api.Document | undefined) : undefined;
  if (!document || !('mimeType' in document)) return null;

  const isVideo =
    document.mimeType?.startsWith('video/') ||
    document.attributes?.some((attr) => attr.className === 'DocumentAttributeVideo');

  if (!isVideo) return null;

  const nameAttr = document.attributes?.find((attr) => attr.className === 'DocumentAttributeFilename') as
    Api.DocumentAttributeFilename | undefined;

  return {
    document,
    size: Number(document.size),
    mimeType: document.mimeType || 'video/mp4',
    fileName: nameAttr?.fileName || `${message.id}.mp4`,
  };
}

async function getVideoMessage(chatId: string, messageId: string | number) {
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

async function listVideos(chatId: string, limit = 20): Promise<VideoListItem[]> {
  const tg = await ensureConnected();
  const messages = await tg.getMessages(chatId, { limit: 200 });

  const videos: VideoListItem[] = [];
  for (const message of messages) {
    const video = extractVideoDocument(message);
    if (video) {
      videos.push({
        message_id: message.id,
        file_name: video.fileName,
        size: video.size,
        mime_type: video.mimeType,
        date: message.date,
      });
    }
    if (videos.length >= limit) break;
  }

  return videos;
}

async function listChannels() {
  const tg = await ensureConnected();
  const dialogs = await tg.getDialogs({});

  return dialogs
    .filter((dialog) => dialog.isChannel)
    .map((dialog) => ({
      chat_id: (dialog.id ?? '').toString(),
      chat_title: dialog.title || dialog.name || (dialog.id ?? '').toString(),
    }));
}

async function getChannelVideos(chatId: string, limit = 20) {
  const tg = await ensureConnected();
  const entity = await tg.getEntity(chatId);
  const chatTitle = ('title' in entity && entity.title) || ('username' in entity && entity.username) || chatId;
  const data = await listVideos(chatId, limit);

  return { chat_id: chatId.toString(), chat_title: chatTitle, data };
}

async function listAllVideos({ perChatLimit = 10 }: { perChatLimit?: number } = {}) {
  const tg = await ensureConnected();
  const dialogs = await tg.getDialogs({});

  const videos = [];
  for (const dialog of dialogs) {
    const chatId = dialog.id;
    if (!chatId) continue;

    let messages;
    try {
      messages = await tg.getMessages(chatId, { limit: 100 });
    } catch {
      continue;
    }

    let foundInChat = 0;
    for (const message of messages) {
      const video = extractVideoDocument(message);
      if (video) {
        videos.push({
          chat_id: chatId.toString(),
          chat_title: dialog.title || dialog.name || chatId.toString(),
          message_id: message.id,
          file_name: video.fileName,
          size: video.size,
          mime_type: video.mimeType,
          date: message.date,
        });
        foundInChat += 1;
      }
      if (foundInChat >= perChatLimit) break;
    }
  }

  return videos;
}

export { client, ensureConnected, getChannelVideos, getVideoMessage, listAllVideos, listChannels, listVideos };
