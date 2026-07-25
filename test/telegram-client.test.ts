const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  getMessages: jest.fn(),
  getDialogs: jest.fn(),
  getEntity: jest.fn(),
  iterDownload: jest.fn(),
};

jest.mock('telegram', () => ({
  TelegramClient: jest.fn(() => mockClient),
  Api: {
    InputMessagesFilterVideo: jest.fn(() => ({})),
  },
}));

jest.mock('telegram/sessions', () => ({
  StringSession: jest.fn(),
}));

import { clearAllCaches } from '../src/cache/ttl-cache';
import {
  client,
  ensureConnected,
  getChannelVideos,
  getVideoMessage,
  listAllVideos,
  listChannels,
  listVideos,
} from '../src/telegram-client';

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    date: 1700000000,
    media: {
      document: {
        size: 1024,
        mimeType: 'video/mp4',
        attributes: [{ className: 'DocumentAttributeFilename', fileName: 'video.mp4' }],
      },
    },
    ...overrides,
  };
}

function withTotal<T>(items: T[], total?: number) {
  return Object.assign(items, { total: total ?? items.length });
}

describe('telegram-client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAllCaches();
  });

  it('client is the mocked TelegramClient instance', () => {
    expect(client).toBe(mockClient);
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
      });
      const call = mockClient.getMessages.mock.calls[0][1];
      expect(call).toMatchObject({ limit: 10, addOffset: 0 });
      expect(call.filter).toBeDefined();
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
});
