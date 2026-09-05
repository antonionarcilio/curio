import type { UploadJobStore } from '@/services/create-upload-job-store';
import { createSignedUrl, type SignedMediaType } from '@/signed-url';

type DeleteMessage = (chatId: string, messageId: string | number) => Promise<void>;

// Decide o desfecho de um upload assim que o envio real ao Telegram termina:
// se um cancelamento foi pedido enquanto o job estava 'uploading' (não dá
// pra abortar tg.uploadFile/tg.sendFile em voo), a mensagem recém-criada é
// apagada em vez de exposta como resultado. `deleteMessage` é injetado pelo
// chamador (vídeo e áudio usam a mesma função genérica de telegram-client).
export function createUploadJobSettler<TItem extends { message_id: number }>(
  store: UploadJobStore<TItem & { url: string }>,
  deleteMessage: DeleteMessage,
  mediaType: SignedMediaType,
) {
  return async function settleUploadJob(jobId: string, chatId: string, base: string, item: TItem): Promise<void> {
    if (store.isCancelRequested(jobId)) {
      await deleteMessage(chatId, item.message_id);
      store.finalizeCancelledJob(jobId);
      return;
    }
    store.completeJob(jobId, { ...item, url: createSignedUrl(base, mediaType, chatId, item.message_id) });
  };
}
