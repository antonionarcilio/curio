import type { VideoListEntry } from '../telegram-client';
import { includesSearchTerm } from '../utils/text-search';

export type VideoFilterQuery = {
  chatId?: string;
  chatTitle?: string;
  fileName?: string;
};

// IDs de canal/supergrupo no Telegram são negativos (ex: -1001234567890);
// comparamos só os dígitos para que o "-" seja irrelevante na busca.
function extractDigits(chatId: string): string {
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
