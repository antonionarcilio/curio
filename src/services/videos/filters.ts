import type { VideoListEntry } from '@/telegram-client';
import { includesSearchTerm } from '@/utils/text-search';

export type VideoFilterQuery = {
  chatId?: string;
  chatTitle?: string;
  fileName?: string;
};

// IDs de canal/supergrupo no Telegram são negativos (ex: -1001234567890);
// comparamos só os dígitos para que o "-" seja irrelevante na busca. Exportada
// porque também é reaproveitada fora de contexto de vídeo (ex: filtro de
// channel_id em src/routes/channels/route.ts).
export function extractDigits(chatId: string): string {
  return chatId.replace(/\D/g, '');
}

function matchesVideoFilters(video: VideoListEntry, filters: VideoFilterQuery): boolean {
  if (filters.chatId && extractDigits(video.chat_id) !== extractDigits(filters.chatId)) return false;
  if (filters.chatTitle && !includesSearchTerm(video.chat_title, filters.chatTitle)) return false;
  if (filters.fileName && !includesSearchTerm(video.file_name, filters.fileName)) return false;
  return true;
}

export function filterVideos(videos: VideoListEntry[], filters: VideoFilterQuery): VideoListEntry[] {
  return videos.filter((video) => matchesVideoFilters(video, filters));
}

// Reutilizável em qualquer listagem de vídeo de um chat só (sem chat_id/chat_title
// no item).
export function filterByFileName<T extends { file_name: string }>(items: T[], fileName?: string): T[] {
  if (!fileName) return items;
  return items.filter((item) => includesSearchTerm(item.file_name, fileName));
}
