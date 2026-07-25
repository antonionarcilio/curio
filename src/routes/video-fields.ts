import type { ChannelVideoItem, VideoListItem } from '@/telegram-client';

// listVideos devolve o item rico de /channels/:channelId/videos (duração,
// dimensões, thumbnail, descrição). /list/:chatId compartilha o mesmo fetch —
// e portanto o mesmo cache — mas mantém deliberadamente o contrato enxuto,
// então projeta o item de volta pros campos base aqui.
export function pickBaseVideoFields(video: ChannelVideoItem): VideoListItem {
  return {
    message_id: video.message_id,
    file_name: video.file_name,
    size: video.size,
    mime_type: video.mime_type,
    date: video.date,
  };
}
