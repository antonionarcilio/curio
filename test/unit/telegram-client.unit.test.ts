const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  getMessages: jest.fn(),
  getDialogs: jest.fn(),
  getEntity: jest.fn(),
  getMe: jest.fn(),
  // getChannelInfoUncached usa isso pra marcar o channel_id com o prefixo
  // "-100" (mesma convenção que dialog.id já usa) — o mock reflete o id da
  // entidade resolvida, igual o TeleProto real faria.
  getPeerId: jest.fn((entity: { id?: unknown }) => Promise.resolve(String(entity?.id))),
  api: {
    channels: {
      getFullChannel: jest.fn(),
    },
  },
  sendFile: jest.fn(),
  uploadFile: jest.fn(),
  editMessage: jest.fn(),
  deleteMessages: jest.fn(),
  downloadMedia: jest.fn(),
};

const mockReadFile = jest.fn().mockResolvedValue(Buffer.from('thumb-bytes'));
jest.mock('fs/promises', () => ({
  readFile: mockReadFile,
}));

jest.mock('teleproto', () => ({
  TelegramClient: jest.fn(() => mockClient),
  Api: {
    InputMessagesFilterVideo: jest.fn(() => ({})),
    DocumentAttributeFilename: jest.fn((opts) => ({ className: 'DocumentAttributeFilename', ...opts })),
    DocumentAttributeVideo: jest.fn((opts) => ({ className: 'DocumentAttributeVideo', ...opts })),
  },
}));

jest.mock('teleproto/sessions', () => ({
  StringSession: jest.fn(),
}));

jest.mock('teleproto/client/uploads', () => ({
  CustomFile: jest.fn().mockImplementation((name, size, path, buffer) => ({ name, size, path, buffer })),
}));

const mockProbeVideoMetadata = jest.fn();
jest.mock('@/services/videos/probe', () => ({
  probeVideoMetadata: mockProbeVideoMetadata,
}));

import {
  client,
  deleteVideoMessage,
  editVideoCaption,
  ensureConnected,
  getChannelInfo,
  getChannelVideos,
  getMyProfile,
  getUploadMaxSize,
  getVideoMessage,
  getVideoThumbnail,
  listAllVideos,
  listChannels,
  listVideos,
  uploadVideo,
} from '@/telegram-client';
import { clearAllCaches } from '@/utils/ttl-cache';

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    size: 1024,
    mimeType: 'video/mp4',
    attributes: [
      { className: 'DocumentAttributeFilename', fileName: 'video.mp4' },
      { className: 'DocumentAttributeVideo', duration: 12, w: 1920, h: 1080, supportsStreaming: true },
    ],
    thumbs: [
      { className: 'PhotoStrippedSize', type: 'i', bytes: Buffer.from([0x01, 0x0a, 0x0a]) },
      { className: 'PhotoSize', type: 'm', w: 320, h: 180, size: 5000 },
      { className: 'PhotoSize', type: 'x', w: 1280, h: 720, size: 40000 },
    ],
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    date: 1700000000,
    media: { document: makeDocument() },
    ...overrides,
  };
}

function withTotal<T>(items: T[], total?: number) {
  return Object.assign(items, { total: total ?? items.length });
}

const UPLOADED_FILE_HANDLE = { className: 'InputFile' };

describe('telegram-client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAllCaches();
    mockClient.uploadFile.mockResolvedValue(UPLOADED_FILE_HANDLE);
    mockProbeVideoMetadata.mockResolvedValue(null);
  });

  it('client is the mocked TelegramClient instance', () => {
    expect(client).toBe(mockClient);
  });

  describe('getMyProfile', () => {
    it('maps the logged-in Telegram user to the public profile contract', async () => {
      mockClient.getMe.mockResolvedValue({
        id: BigInt(123456789),
        firstName: 'Ana',
        username: 'ana',
        premium: true,
      });

      await expect(getMyProfile()).resolves.toEqual({
        id: '123456789',
        first_name: 'Ana',
        last_name: null,
        username: 'ana',
        premium: true,
      });
    });

    it('normalizes omitted profile text fields and premium status', async () => {
      mockClient.getMe.mockResolvedValue({ id: BigInt(7) });

      await expect(getMyProfile()).resolves.toEqual({
        id: '7',
        first_name: null,
        last_name: null,
        username: null,
        premium: false,
      });
    });
  });

  describe('getUploadMaxSize', () => {
    it('uses the premium limit and bypasses the profile cache', async () => {
      mockClient.getMe.mockResolvedValue({ premium: true });

      await expect(getUploadMaxSize()).resolves.toBe(4 * 1024 * 1024 * 1024);
      await expect(getUploadMaxSize()).resolves.toBe(4 * 1024 * 1024 * 1024);

      expect(mockClient.getMe).toHaveBeenCalledTimes(2);
    });

    it('uses the standard limit for a non-premium account', async () => {
      mockClient.getMe.mockResolvedValue({ premium: false });

      await expect(getUploadMaxSize()).resolves.toBe(2 * 1024 * 1024 * 1024);
    });
  });

  describe('ensureConnected', () => {
    it('calls connect() at most once across multiple calls', async () => {
      await ensureConnected();
      await ensureConnected();
      await ensureConnected();
      expect(mockClient.connect.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('getVideoMessage', () => {
    it('extracts the video document from the message', async () => {
      mockClient.getMessages.mockResolvedValue([makeMessage()]);
      const result = await getVideoMessage('chat1', 1);
      expect(result.mimeType).toBe('video/mp4');
      expect(result.fileName).toBe('video.mp4');
      expect(result.size).toBe(1024);
    });

    it('throws "Mensagem não encontrada" when getMessages returns empty', async () => {
      mockClient.getMessages.mockResolvedValue([]);
      await expect(getVideoMessage('chat1', 2)).rejects.toThrow('Mensagem não encontrada');
    });

    it('throws "Mensagem não contém um vídeo" when message has no video document', async () => {
      mockClient.getMessages.mockResolvedValue([makeMessage({ media: undefined })]);
      await expect(getVideoMessage('chat1', 3)).rejects.toThrow('Mensagem não contém um vídeo');
    });

    it('falls back to "<id>.mp4" filename when no DocumentAttributeFilename is present', async () => {
      mockClient.getMessages.mockResolvedValue([
        makeMessage({
          id: 99,
          media: { document: { size: 10, mimeType: 'video/mp4', attributes: [] } },
        }),
      ]);
      const result = await getVideoMessage('chat1', 99);
      expect(result.fileName).toBe('99.mp4');
    });

    it('caches the result for the same chatId:messageId key (getMessages called once)', async () => {
      mockClient.getMessages.mockResolvedValue([makeMessage({ id: 42 })]);
      await getVideoMessage('chatCache', 42);
      await getVideoMessage('chatCache', 42);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(1);
    });

    it('warms the entity cache via getDialogs and retries when getEntity fails cold, then succeeds', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockResolvedValueOnce({ id: 1004325653681 });
      mockClient.getDialogs.mockResolvedValue([]);
      mockClient.getMessages.mockResolvedValue([makeMessage({ id: 7 })]);

      const result = await getVideoMessage('coldChat', 7);

      expect(mockClient.getDialogs).toHaveBeenCalledTimes(1);
      expect(mockClient.getEntity).toHaveBeenCalledTimes(2);
      expect(result.fileName).toBe('video.mp4');
    });

    it('rejects with a clear error when entity resolution still fails after warming the cache', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getDialogs.mockResolvedValue([]);

      await expect(getVideoMessage('unresolvableChat', 8)).rejects.toThrow(/unresolvableChat/);
      expect(mockClient.getMessages).not.toHaveBeenCalled();
    });
  });

  describe('getVideoThumbnail', () => {
    it('downloads the largest PhotoSize and returns it as a jpeg data URI', async () => {
      mockClient.getMessages.mockResolvedValue([makeMessage({ id: 20 })]);
      mockClient.downloadMedia.mockResolvedValue(Buffer.from('jpeg-bytes'));

      const result = await getVideoThumbnail('chatThumb', 20);

      expect(result).toEqual({
        thumbnail: `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`,
        thumbnail_width: 1280,
        thumbnail_height: 720,
      });
      const [, params] = mockClient.downloadMedia.mock.calls[0];
      expect(params.thumb).toMatchObject({ className: 'PhotoSize', w: 1280, h: 720 });
    });

    it('caches the bytes for the same chatId:messageId key (downloadMedia called once)', async () => {
      mockClient.getMessages.mockResolvedValue([makeMessage({ id: 21 })]);
      mockClient.downloadMedia.mockResolvedValue(Buffer.from('jpeg-bytes'));

      await getVideoThumbnail('chatThumbCache', 21);
      await getVideoThumbnail('chatThumbCache', 21);

      expect(mockClient.downloadMedia).toHaveBeenCalledTimes(1);
    });

    it('rejects with the offending ids when the document has no downloadable thumbnail', async () => {
      mockClient.getMessages.mockResolvedValue([
        makeMessage({ id: 22, media: { document: makeDocument({ thumbs: [] }) } }),
      ]);

      await expect(getVideoThumbnail('chatNoThumb', 22)).rejects.toThrow(/chatNoThumb:22.*PhotoSize/s);
      expect(mockClient.downloadMedia).not.toHaveBeenCalled();
    });

    it('rejects when downloadMedia returns no bytes', async () => {
      mockClient.getMessages.mockResolvedValue([makeMessage({ id: 23 })]);
      mockClient.downloadMedia.mockResolvedValue(undefined);

      await expect(getVideoThumbnail('chatEmptyThumb', 23)).rejects.toThrow(/chatEmptyThumb:23/);
    });
  });

  describe('listVideos', () => {
    it('passes an Api.InputMessagesFilterVideo filter and maps items with total', async () => {
      mockClient.getMessages.mockResolvedValue(withTotal([makeMessage({ id: 1 }), makeMessage({ id: 2 })], 2));
      const result = await listVideos('chatX', { limit: 10, offset: 0 });
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        message_id: 1,
        file_name: 'video.mp4',
        size: 1024,
        mime_type: 'video/mp4',
        date: 1700000000,
        description: null,
        duration: 12,
        width: 1920,
        height: 1080,
        supports_streaming: true,
        thumbnail_width: 1280,
        thumbnail_height: 720,
        thumbnail: null,
      });
      const call = mockClient.getMessages.mock.calls[0][1];
      expect(call).toMatchObject({ limit: 10, addOffset: 0 });
      expect(call.filter).toBeDefined();
    });

    it('exposes the caption as description', async () => {
      mockClient.getMessages.mockResolvedValue(withTotal([makeMessage({ message: 'aula sobre streaming' })]));
      const result = await listVideos('chatCaption', { limit: 10, offset: 0 });
      expect(result.items[0].description).toBe('aula sobre streaming');
    });

    it('nulls the video/thumbnail metadata when the document has neither DocumentAttributeVideo nor thumbs', async () => {
      mockClient.getMessages.mockResolvedValue(
        withTotal([makeMessage({ media: { document: makeDocument({ attributes: [], thumbs: undefined }) } })]),
      );

      const result = await listVideos('chatNoMeta', { limit: 10, offset: 0 });

      expect(result.items[0]).toMatchObject({
        duration: null,
        width: null,
        height: null,
        supports_streaming: false,
        thumbnail_width: null,
        thumbnail_height: null,
        thumbnail: null,
      });
    });

    it('nulls thumbnail_width/height when only a non-PhotoSize thumb (e.g. stripped) is present', async () => {
      mockClient.getMessages.mockResolvedValue(
        withTotal([
          makeMessage({
            media: {
              document: makeDocument({
                thumbs: [{ className: 'PhotoStrippedSize', type: 'i', bytes: Buffer.from([0x01]) }],
              }),
            },
          }),
        ]),
      );

      const result = await listVideos('chatStrippedOnly', { limit: 10, offset: 0 });

      expect(result.items[0].thumbnail_width).toBeNull();
      expect(result.items[0].thumbnail).toBeNull();
    });

    it('skips non-video messages returned by getMessages', async () => {
      mockClient.getMessages.mockResolvedValue(withTotal([makeMessage({ media: undefined })]));
      const result = await listVideos('chatY', { limit: 10, offset: 0 });
      expect(result.items).toHaveLength(0);
    });

    it('falls back to "video/mp4" when the document has no mimeType', async () => {
      mockClient.getMessages.mockResolvedValue(
        withTotal([
          makeMessage({
            media: { document: { size: 10, mimeType: '', attributes: [] } },
          }),
        ]),
      );
      const result = await listVideos('chatZ', { limit: 10, offset: 0 });
      expect(result.items[0].mime_type).toBe('video/mp4');
    });

    it('warms the entity cache via getDialogs and retries when getEntity fails cold, then succeeds', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockResolvedValueOnce({ id: 1 });
      mockClient.getDialogs.mockResolvedValue([]);
      mockClient.getMessages.mockResolvedValue(withTotal([makeMessage({ id: 1 })]));

      const result = await listVideos('coldChatList', { limit: 10, offset: 0 });

      expect(mockClient.getDialogs).toHaveBeenCalledTimes(1);
      expect(mockClient.getEntity).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(1);
    });

    it('rejects with a clear error when entity resolution still fails after warming the cache', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getDialogs.mockResolvedValue([]);

      await expect(listVideos('unresolvableChatList', { limit: 10, offset: 0 })).rejects.toThrow(
        /unresolvableChatList/,
      );
      expect(mockClient.getMessages).not.toHaveBeenCalled();
    });

    it('falls back total to items.length when getMessages result has no .total', async () => {
      const messages = [makeMessage({ id: 1 }), makeMessage({ id: 2 })];
      mockClient.getMessages.mockResolvedValue(messages);
      const result = await listVideos('chatNoTotal', { limit: 10, offset: 0 });
      expect(result.total).toBe(result.items.length);
      expect(result.total).toBe(2);
    });
  });

  describe('listChannels', () => {
    it('filters dialogs to isChannel === true only, using channel_id/channel_title', async () => {
      mockClient.getDialogs.mockResolvedValue([
        { id: 1, isChannel: true, title: 'Channel A' },
        { id: 2, isChannel: false, title: 'Not a channel' },
      ]);
      const channels = await listChannels(100);
      expect(channels).toEqual([{ channel_id: '1', channel_title: 'Channel A' }]);
    });

    it('falls back to name, then id, when title is missing', async () => {
      mockClient.getDialogs.mockResolvedValue([
        { id: 5, isChannel: true, title: undefined, name: 'name-fallback' },
        { id: 6, isChannel: true, title: undefined, name: undefined },
      ]);
      const channels = await listChannels(100);
      expect(channels).toEqual([
        { channel_id: '5', channel_title: 'name-fallback' },
        { channel_id: '6', channel_title: '6' },
      ]);
    });

    it('falls back channel_id and channel_title to "" when dialog.id is nullish', async () => {
      mockClient.getDialogs.mockResolvedValue([{ id: undefined, isChannel: true, title: undefined, name: undefined }]);
      const channels = await listChannels(100);
      expect(channels).toEqual([{ channel_id: '', channel_title: '' }]);
    });
  });

  describe('getChannelInfo', () => {
    it('returns basic channel details with the Telegram about field as description', async () => {
      mockClient.getEntity.mockResolvedValue({
        className: 'Channel',
        id: -1003915432695,
        title: 'Smoke Tests',
        username: 'smoke_tests',
        broadcast: true,
      });
      mockClient.api.channels.getFullChannel.mockResolvedValue({
        fullChat: {
          className: 'ChannelFull',
          about: 'Canal usado nos testes e2e',
          participantsCount: 12,
          adminsCount: 2,
          kickedCount: 1,
          bannedCount: 0,
          onlineCount: 3,
        },
      });

      const info = await getChannelInfo('-1003915432695');

      expect(info).toEqual({
        channel_id: '-1003915432695',
        channel_title: 'Smoke Tests',
        description: 'Canal usado nos testes e2e',
        username: 'smoke_tests',
        type: 'channel',
        participants_count: 12,
        admins_count: 2,
        kicked_count: 1,
        banned_count: 0,
        online_count: 3,
      });
    });

    it('returns null for optional details that Telegram omits and classifies megagroups', async () => {
      mockClient.getEntity.mockResolvedValue({
        className: 'Channel',
        id: -100111,
        title: 'Grupo',
        megagroup: true,
      });
      mockClient.api.channels.getFullChannel.mockResolvedValue({
        fullChat: {
          className: 'ChannelFull',
          about: '',
        },
      });

      const info = await getChannelInfo('-100111');

      expect(info).toEqual({
        channel_id: '-100111',
        channel_title: 'Grupo',
        description: null,
        username: null,
        type: 'supergroup',
        participants_count: null,
        admins_count: null,
        kicked_count: null,
        banned_count: null,
        online_count: null,
      });
    });

    it('caches channel info for the same channel_id', async () => {
      mockClient.getEntity.mockResolvedValue({ className: 'Channel', id: -100222, title: 'Cached', broadcast: true });
      mockClient.api.channels.getFullChannel.mockResolvedValue({
        fullChat: { className: 'ChannelFull', about: 'cache' },
      });

      await getChannelInfo('-100222');
      await getChannelInfo('-100222');

      expect(mockClient.api.channels.getFullChannel).toHaveBeenCalledTimes(1);
    });

    it('rejects with a clear error when the resolved entity is not a channel', async () => {
      mockClient.getEntity.mockResolvedValue({ className: 'User', id: 10, firstName: 'Alice' });

      await expect(getChannelInfo('alice')).rejects.toThrow(/não é um canal/);
      expect(mockClient.api.channels.getFullChannel).not.toHaveBeenCalled();
    });
  });

  describe('getChannelVideos', () => {
    it('resolves channel_title from title -> username -> chatId and delegates to listVideos', async () => {
      mockClient.getEntity.mockResolvedValue({ title: 'My Channel' });
      mockClient.getMessages.mockResolvedValue(withTotal([]));
      const result = await getChannelVideos('chat1', { limit: 5, offset: 0 });
      expect(result).toEqual({ channel_id: 'chat1', channel_title: 'My Channel', items: [], total: 0 });
    });

    it('falls back to username when there is no title', async () => {
      mockClient.getEntity.mockResolvedValue({ username: 'my_channel' });
      mockClient.getMessages.mockResolvedValue(withTotal([]));
      const result = await getChannelVideos('chat2', { limit: 5, offset: 0 });
      expect(result.channel_title).toBe('my_channel');
    });

    it('falls back to chatId when neither title nor username exist', async () => {
      mockClient.getEntity.mockResolvedValue({});
      mockClient.getMessages.mockResolvedValue(withTotal([]));
      const result = await getChannelVideos('chat3', { limit: 5, offset: 0 });
      expect(result.channel_title).toBe('chat3');
    });
  });

  describe('listAllVideos', () => {
    it('applies perChatLimit per chat, not globally', async () => {
      mockClient.getDialogs.mockResolvedValue([
        { id: 1, title: 'Chat 1' },
        { id: 2, title: 'Chat 2' },
      ]);
      mockClient.getMessages.mockResolvedValue(
        withTotal([makeMessage({ id: 1 }), makeMessage({ id: 2 }), makeMessage({ id: 3 })]),
      );
      const videos = await listAllVideos({ perChatLimit: 2 });
      // fetchDialogVideos requests `limit: perChatLimit` from getMessages directly
      // (server-side limit), so each chat returns at most the 3 mocked messages
      // capped implicitly by the mock; assert both chats contributed videos.
      const chatIds = new Set(videos.map((v) => v.chat_id));
      expect(chatIds).toEqual(new Set(['1', '2']));
    });

    it('ignores a chat whose getMessages call fails and continues to the next', async () => {
      mockClient.getDialogs.mockResolvedValue([
        { id: 1, title: 'Broken chat' },
        { id: 2, title: 'Working chat' },
      ]);
      mockClient.getMessages.mockImplementation(async (chatId: unknown) => {
        if (chatId === 1) throw new Error('boom');
        return withTotal([makeMessage({ id: 10 })]);
      });
      const videos = await listAllVideos({ perChatLimit: 10 });
      expect(videos).toHaveLength(1);
      expect(videos[0].chat_id).toBe('2');
    });

    it('skips dialogs with a falsy id', async () => {
      mockClient.getDialogs.mockResolvedValue([
        { id: 0, title: 'No id' },
        { id: 7, title: 'Has id' },
      ]);
      mockClient.getMessages.mockResolvedValue(withTotal([makeMessage({ id: 1 })]));
      const videos = await listAllVideos({ perChatLimit: 10 });
      expect(videos).toHaveLength(1);
      expect(videos[0].chat_id).toBe('7');
    });

    it('skips non-video messages within a dialog', async () => {
      mockClient.getDialogs.mockResolvedValue([{ id: 1, title: 'Chat 1' }]);
      mockClient.getMessages.mockResolvedValue(withTotal([makeMessage({ media: undefined })]));
      const videos = await listAllVideos({ perChatLimit: 10 });
      expect(videos).toHaveLength(0);
    });

    it('falls back chat_title to name, then to chatId, when title is missing', async () => {
      mockClient.getDialogs.mockResolvedValue([
        { id: 1, title: undefined, name: 'name-fallback' },
        { id: 2, title: undefined, name: undefined },
      ]);
      mockClient.getMessages.mockResolvedValue(withTotal([makeMessage({ id: 1 })]));
      const videos = await listAllVideos({ perChatLimit: 10 });
      const titles = videos.map((v) => v.chat_title);
      expect(titles).toContain('name-fallback');
      expect(titles).toContain('2');
    });

    it('defaults perChatLimit to 100 when called without arguments', async () => {
      mockClient.getDialogs.mockResolvedValue([{ id: 1, title: 'Chat 1' }]);
      mockClient.getMessages.mockResolvedValue(withTotal([makeMessage({ id: 1 })]));
      await listAllVideos();
      const call = mockClient.getMessages.mock.calls[0][1];
      expect(call).toMatchObject({ limit: 100 });
    });
  });

  describe('uploadVideo', () => {
    it('sends the file via sendFile with the original filename, thumbnail and caption, and returns the metadata', async () => {
      mockClient.sendFile.mockResolvedValue(
        makeMessage({
          id: 55,
          media: {
            document: {
              size: 2048,
              mimeType: 'video/mp4',
              attributes: [{ className: 'DocumentAttributeFilename', fileName: 'original.mp4' }],
            },
          },
        }),
      );

      const result = await uploadVideo('me', {
        videoPath: '/tmp/video.mp4',
        videoSize: 11,
        originalFileName: 'original.mp4',
        description: 'uma descrição',
        thumbnailPath: '/tmp/thumb.jpg',
      });

      expect(mockClient.uploadFile).toHaveBeenCalledTimes(1);
      const uploadFileParams = mockClient.uploadFile.mock.calls[0][0];
      expect(uploadFileParams.file).toMatchObject({ name: 'original.mp4' });
      expect(uploadFileParams.file).toMatchObject({ size: 11, path: '/tmp/video.mp4' });

      expect(mockClient.sendFile).toHaveBeenCalledTimes(1);
      const [chatId, options] = mockClient.sendFile.mock.calls[0];
      expect(chatId).toBe('me');
      expect(options.caption).toBe('uma descrição');
      expect(options.forceDocument).toBe(false);
      expect(options.supportsStreaming).toBe(true);
      // sendFile recebe o handle já enviado (retorno de uploadFile), não o
      // CustomFile bruto — é isso que faz o sendFile pular a etapa de upload
      // (que sempre tentaria ler de `file.path`, vazio aqui) e ir direto pra
      // montagem da mensagem.
      expect(options.file).toBe(UPLOADED_FILE_HANDLE);
      // thumb precisa ser o Buffer cru — sendFile só reconhece
      // Buffer.isBuffer(thumb) nesse branch, nunca um CustomFile.
      expect(Buffer.isBuffer(options.thumb)).toBe(true);
      expect(mockReadFile).toHaveBeenCalledWith('/tmp/thumb.jpg');
      expect(options.attributes[0]).toMatchObject({ fileName: 'original.mp4' });

      expect(result).toEqual({
        message_id: 55,
        file_name: 'original.mp4',
        size: 2048,
        mime_type: 'video/mp4',
        date: 1700000000,
      });
    });

    it('uses the request-selected maximum buffer size', async () => {
      mockClient.sendFile.mockResolvedValue(makeMessage({ id: 61 }));

      await uploadVideo('me', {
        videoPath: '/tmp/video.mp4',
        videoSize: 11,
        originalFileName: 'original.mp4',
        maxUploadSizeBytes: 40,
      });

      expect(mockClient.uploadFile.mock.calls[0][0].maxBufferSize).toBe(40);
    });

    it('passes onProgress through to tg.uploadFile', async () => {
      mockClient.sendFile.mockResolvedValue(makeMessage({ id: 60 }));
      const onProgress = jest.fn();

      await uploadVideo('me', {
        videoPath: '/tmp/video.mp4',
        videoSize: 11,
        originalFileName: 'original.mp4',
        onProgress,
      });

      const uploadFileParams = mockClient.uploadFile.mock.calls[0][0];
      expect(uploadFileParams.onProgress).toBe(onProgress);
    });

    it('adds a DocumentAttributeVideo with the probed duration/width/height when ffprobe succeeds', async () => {
      mockProbeVideoMetadata.mockResolvedValue({ duration: 12, width: 1920, height: 1080 });
      mockClient.sendFile.mockResolvedValue(makeMessage({ id: 59 }));

      await uploadVideo('me', { videoPath: '/tmp/video.mp4', videoSize: 11, originalFileName: 'original.mp4' });

      expect(mockProbeVideoMetadata).toHaveBeenCalledWith('/tmp/video.mp4');
      const options = mockClient.sendFile.mock.calls[0][1];
      expect(options.attributes).toHaveLength(2);
      expect(options.attributes[1]).toMatchObject({
        className: 'DocumentAttributeVideo',
        duration: 12,
        w: 1920,
        h: 1080,
        supportsStreaming: true,
      });
    });

    it('omits DocumentAttributeVideo when ffprobe fails/is unavailable', async () => {
      mockProbeVideoMetadata.mockResolvedValue(null);
      mockClient.sendFile.mockResolvedValue(makeMessage({ id: 60 }));

      await uploadVideo('me', { videoPath: '/tmp/video.mp4', videoSize: 11, originalFileName: 'original.mp4' });

      const options = mockClient.sendFile.mock.calls[0][1];
      expect(options.attributes).toHaveLength(1);
    });

    it('uploads without optional thumbnail/caption', async () => {
      mockClient.sendFile.mockResolvedValue(makeMessage({ id: 56 }));

      await uploadVideo('me', {
        videoPath: '/tmp/video.mp4',
        videoSize: 11,
        originalFileName: 'original.mp4',
      });

      const uploadFileParams = mockClient.uploadFile.mock.calls[0][0];
      expect(uploadFileParams.file).toMatchObject({ name: 'original.mp4' });

      const options = mockClient.sendFile.mock.calls[0][1];
      expect(options.file).toBe(UPLOADED_FILE_HANDLE);
      expect(options.thumb).toBeUndefined();
      expect(options.caption).toBeUndefined();
    });

    it('clears all caches after a successful upload', async () => {
      mockClient.getMessages.mockResolvedValue([makeMessage({ id: 1 })]);
      await getVideoMessage('chatCache2', 1);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(1);

      mockClient.sendFile.mockResolvedValue(makeMessage({ id: 57 }));
      await uploadVideo('me', { videoPath: '/tmp/a.mp4', videoSize: 1, originalFileName: 'a.mp4' });

      await getVideoMessage('chatCache2', 1);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(2);
    });

    it('warms the entity cache via getDialogs and retries when getEntity fails cold, then succeeds', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockResolvedValueOnce({ id: -1003915432695 });
      mockClient.getDialogs.mockResolvedValue([]);
      mockClient.sendFile.mockResolvedValue(makeMessage({ id: 58 }));

      const result = await uploadVideo('coldChannel', {
        videoPath: '/tmp/a.mp4',
        videoSize: 1,
        originalFileName: 'a.mp4',
      });

      expect(mockClient.getDialogs).toHaveBeenCalledTimes(1);
      expect(mockClient.getEntity).toHaveBeenCalledTimes(2);
      expect(result.message_id).toBe(58);
    });

    it('rejects with a clear error when entity resolution still fails after warming the cache', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getDialogs.mockResolvedValue([]);

      await expect(
        uploadVideo('unresolvableChannel', { videoPath: '/tmp/a.mp4', videoSize: 1, originalFileName: 'a.mp4' }),
      ).rejects.toThrow(/unresolvableChannel/);
      expect(mockClient.sendFile).not.toHaveBeenCalled();
    });
  });

  describe('editVideoCaption', () => {
    it('calls editMessage with the message id and new caption', async () => {
      mockClient.editMessage.mockResolvedValue(makeMessage());
      await editVideoCaption('chat1', 10, 'nova descrição');
      expect(mockClient.editMessage).toHaveBeenCalledWith('chat1', { message: 10, text: 'nova descrição' });
    });

    it('clears all caches after a successful edit', async () => {
      mockClient.getMessages.mockResolvedValue([makeMessage({ id: 2 })]);
      await getVideoMessage('chatCache3', 2);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(1);

      mockClient.editMessage.mockResolvedValue(makeMessage());
      await editVideoCaption('chatCache3', 2, 'nova descrição');

      await getVideoMessage('chatCache3', 2);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(2);
    });

    it('warms the entity cache via getDialogs and retries when getEntity fails cold, then succeeds', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockResolvedValueOnce({ id: -1003915432695 });
      mockClient.getDialogs.mockResolvedValue([]);
      mockClient.editMessage.mockResolvedValue(makeMessage());

      await editVideoCaption('coldChannelEdit', 10, 'nova descrição');

      expect(mockClient.getDialogs).toHaveBeenCalledTimes(1);
      expect(mockClient.getEntity).toHaveBeenCalledTimes(2);
      expect(mockClient.editMessage).toHaveBeenCalledTimes(1);
    });

    it('rejects with a clear error when entity resolution still fails after warming the cache', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getDialogs.mockResolvedValue([]);

      await expect(editVideoCaption('unresolvableChannelEdit', 10, 'nova descrição')).rejects.toThrow(
        /unresolvableChannelEdit/,
      );
      expect(mockClient.editMessage).not.toHaveBeenCalled();
    });
  });

  describe('deleteVideoMessage', () => {
    it('calls deleteMessages with the message id and revoke: true', async () => {
      mockClient.deleteMessages.mockResolvedValue(undefined);
      await deleteVideoMessage('chat1', 10);
      expect(mockClient.deleteMessages).toHaveBeenCalledWith('chat1', [10], { revoke: true });
    });

    it('clears all caches after a successful delete', async () => {
      mockClient.getMessages.mockResolvedValue([makeMessage({ id: 3 })]);
      await getVideoMessage('chatCache4', 3);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(1);

      mockClient.deleteMessages.mockResolvedValue(undefined);
      await deleteVideoMessage('chatCache4', 3);

      await getVideoMessage('chatCache4', 3);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(2);
    });

    it('warms the entity cache via getDialogs and retries when getEntity fails cold, then succeeds', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockResolvedValueOnce({ id: -1003915432695 });
      mockClient.getDialogs.mockResolvedValue([]);
      mockClient.deleteMessages.mockResolvedValue(undefined);

      await deleteVideoMessage('coldChannelDelete', 10);

      expect(mockClient.getDialogs).toHaveBeenCalledTimes(1);
      expect(mockClient.getEntity).toHaveBeenCalledTimes(2);
      expect(mockClient.deleteMessages).toHaveBeenCalledTimes(1);
    });

    it('rejects with a clear error when entity resolution still fails after warming the cache', async () => {
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getEntity.mockRejectedValueOnce(new Error('Could not find the input entity for {}'));
      mockClient.getDialogs.mockResolvedValue([]);

      await expect(deleteVideoMessage('unresolvableChannelDelete', 10)).rejects.toThrow(/unresolvableChannelDelete/);
      expect(mockClient.deleteMessages).not.toHaveBeenCalled();
    });
  });
});
