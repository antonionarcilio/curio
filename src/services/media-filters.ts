import { includesSearchTerm } from '@/utils/text-search';

export type MediaFilterQuery = {
  chatId?: string;
  chatTitle?: string;
  fileName?: string;
  description?: string;
};

type MediaTextFilterQuery = {
  fileName?: string;
  description?: string;
};

type MediaListEntry = {
  chat_id: string;
  chat_title: string;
  file_name: string;
  description: string | null;
};

// IDs de canal/supergrupo no Telegram são negativos (ex: -1001234567890);
// comparamos só os dígitos para que o "-" seja irrelevante na busca. Exportada
// porque também é reaproveitada fora de contexto de mídia (ex: filtro de
// channel_id em src/routes/channels/route.ts).
export function extractDigits(chatId: string): string {
  return chatId.replace(/\D/g, '');
}

function matchesMediaFilters(item: MediaListEntry, filters: MediaFilterQuery): boolean {
  if (filters.chatId && extractDigits(item.chat_id) !== extractDigits(filters.chatId)) return false;
  if (filters.chatTitle && !includesSearchTerm(item.chat_title, filters.chatTitle)) return false;
  if (filters.fileName && !includesSearchTerm(item.file_name, filters.fileName)) return false;
  if (filters.description && !includesSearchTerm(item.description ?? '', filters.description)) return false;
  return true;
}

// Usado por /videos/grouped e /audios/grouped (qualquer listagem agregada
// entre chats, com chat_id/chat_title no item).
export function filterMediaItems<T extends MediaListEntry>(items: T[], filters: MediaFilterQuery): T[] {
  return items.filter((item) => matchesMediaFilters(item, filters));
}

// Reutilizável em qualquer listagem de mídia de um chat só (sem chat_id/chat_title
// no item).
export function filterByFileName<T extends { file_name: string }>(items: T[], fileName?: string): T[] {
  return filterByMediaText(items, { fileName });
}

export function filterByMediaText<T extends { file_name: string; description?: string | null }>(
  items: T[],
  filters: MediaTextFilterQuery,
): T[] {
  if (!filters.fileName && !filters.description) return items;
  return items.filter((item) => {
    if (filters.fileName && !includesSearchTerm(item.file_name, filters.fileName)) return false;
    if (filters.description && !includesSearchTerm(item.description ?? '', filters.description)) return false;
    return true;
  });
}
