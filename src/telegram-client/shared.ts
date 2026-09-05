import config from '@/config';
import { clearAllCaches, withCache } from '@/utils/ttl-cache';
import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';

export const client = new TelegramClient(new StringSession(config.session), config.apiId, config.apiHash, {
  connectionRetries: 5,
});

let connected = false;

export async function ensureConnected(): Promise<TelegramClient> {
  if (!connected) {
    await client.connect();
    connected = true;
  }
  return client;
}

export type ThumbnailInfo = {
  thumbnail_width: number | null;
  thumbnail_height: number | null;
  thumbnail: string | null;
};

// /channels só lida com peers do tipo Channel (TeleProto: dialog.isChannel), por
// isso usa channel_id/channel_title.
export type ChannelListEntry = {
  channel_id: string;
  channel_title: string;
};

export type ChannelInfo = {
  channel_id: string;
  channel_title: string;
  description: string | null;
  username: string | null;
  type: 'channel' | 'supergroup';
  participants_count: number | null;
  admins_count: number | null;
  kicked_count: number | null;
  banned_count: number | null;
  online_count: number | null;
};

export type MyProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  premium: boolean;
};

export type MediaFetchParams = { limit: number; offset: number };

export type Dialog = Awaited<ReturnType<TelegramClient['getDialogs']>>[number];

// Só PhotoSize carrega w/h; PhotoStrippedSize/PhotoCachedSize não têm dimensões
// declaradas no schema do MTProto, então não servem pra thumbnail_width/height.
export function findLargestPhotoSize(thumbs: Api.TypePhotoSize[]): Api.PhotoSize | undefined {
  return thumbs
    .filter((thumb): thumb is Api.PhotoSize => thumb.className === 'PhotoSize')
    .reduce<Api.PhotoSize | undefined>(
      (largest, thumb) => (!largest || thumb.w > largest.w ? thumb : largest),
      undefined,
    );
}

export function toJpegDataUri(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

export function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function valueToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

// TeleProto só resolve um chatId numérico bruto pra getMessages/getEntity se o
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

export const resolveEntity = withCache(config.cacheTtlMs, (chatId: string) => chatId, resolveEntityUncached);

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

export const listChannels = withCache(config.cacheTtlMs, (limit: number) => `${limit}`, listChannelsUncached);

async function getMyProfileUncached(): Promise<MyProfile> {
  const tg = await ensureConnected();
  const me = await tg.getMe();

  return {
    id: me.id.toString(),
    first_name: optionalString(me.firstName),
    last_name: optionalString(me.lastName),
    username: optionalString(me.username),
    premium: me.premium ?? false,
  };
}

export const getMyProfile = withCache(config.cacheTtlMs, () => 'me', getMyProfileUncached);

async function getChannelInfoUncached(channelId: string): Promise<ChannelInfo> {
  const entity = (await resolveEntity(channelId)) as Api.TypeEntityLike & {
    className?: string;
    id?: unknown;
    title?: string;
    username?: string;
    broadcast?: boolean;
    megagroup?: boolean;
  };

  if (entity.className !== 'Channel') {
    throw new Error(`A entidade "${channelId}" não é um canal ou supergrupo do Telegram`);
  }

  const tg = await ensureConnected();
  const full = (await tg.api.channels.getFullChannel({ channel: entity })) as {
    fullChat?: {
      about?: string;
      participantsCount?: number;
      adminsCount?: number;
      kickedCount?: number;
      bannedCount?: number;
      onlineCount?: number;
    };
  };
  const fullChat = full.fullChat ?? {};
  // entity.id é o ID cru do MTProto (sem o prefixo "-100"); listChannelsUncached
  // usa dialog.id, que o TeleProto já retorna marcado (Utils.getPeerId com
  // addMark=true) — sem isso, /channel/:channel_id devolvia um channel_id em
  // formato diferente do que /channels usa pro mesmo canal.
  const markedChannelId = valueToString(await tg.getPeerId(entity));

  return {
    channel_id: markedChannelId ?? valueToString(entity.id) ?? channelId,
    channel_title: entity.title || entity.username || channelId,
    description: optionalString(fullChat.about),
    username: optionalString(entity.username),
    type: entity.megagroup ? 'supergroup' : 'channel',
    participants_count: optionalNumber(fullChat.participantsCount),
    admins_count: optionalNumber(fullChat.adminsCount),
    kicked_count: optionalNumber(fullChat.kickedCount),
    banned_count: optionalNumber(fullChat.bannedCount),
    online_count: optionalNumber(fullChat.onlineCount),
  };
}

export const getChannelInfo = withCache(config.cacheTtlMs, (channelId: string) => channelId, getChannelInfoUncached);

// Mesmo teto que o próprio Telegram aplica a contas normais.
export const STANDARD_MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
export const PREMIUM_MAX_UPLOAD_SIZE_BYTES = 4 * 1024 * 1024 * 1024;

// Não reutiliza o cache de getMyProfile: o limite de upload precisa refletir
// o plano atual no instante em que a requisição começa a receber seus bytes.
export async function getUploadMaxSize(): Promise<number> {
  const tg = await ensureConnected();
  const me = await tg.getMe();
  return me.premium ? PREMIUM_MAX_UPLOAD_SIZE_BYTES : STANDARD_MAX_UPLOAD_SIZE_BYTES;
}

// editMessage do Telegram só troca os bytes do arquivo (file/forceDocument),
// nunca nome/thumbnail (attributes/thumb) — por isso thumbnail customizado só
// é possível no upload, via sendFile, nunca numa edição de mensagem existente
// (ver CLAUDE.md/docs/ROUTES.md para o motivo). Genérica: vídeo e áudio
// compartilham a mesma operação (só trocam legenda de uma mensagem existente).
export async function editMessageCaption(
  chatId: string,
  messageId: string | number,
  description: string,
): Promise<void> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  await tg.editMessage(chatId, { message: Number(messageId), text: description });
  clearAllCaches();
}

export async function deleteMessage(chatId: string, messageId: string | number): Promise<void> {
  const tg = await ensureConnected();
  await resolveEntity(chatId);
  await tg.deleteMessages(chatId, [Number(messageId)], { revoke: true });
  clearAllCaches();
}
