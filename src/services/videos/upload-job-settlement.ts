import { completeJob, finalizeCancelledJob, isCancelRequested } from '@/services/upload-progress-store';
import { createSignedUrl } from '@/signed-url';
import type { VideoListItem } from '@/telegram-client';
import { deleteVideoMessage } from '@/telegram-client';

// Decide o desfecho de um upload assim que o envio real ao Telegram termina:
// se um cancelamento foi pedido enquanto o job estava 'uploading' (não dá
// pra abortar tg.uploadFile/tg.sendFile em voo), a mensagem recém-criada é
// apagada em vez de exposta como resultado.
export async function settleUploadJob(
  jobId: string,
  chatId: string,
  base: string,
  video: VideoListItem,
): Promise<void> {
  if (isCancelRequested(jobId)) {
    await deleteVideoMessage(chatId, video.message_id);
    finalizeCancelledJob(jobId);
    return;
  }
  completeJob(jobId, { ...video, url: createSignedUrl(base, chatId, video.message_id) });
}
