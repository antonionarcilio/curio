import config from '@/config';
import { getJob, startJob } from '@/services/upload-progress-store';
import type { VideoListItem } from '@/telegram-client';

type QueuedUpload = {
  jobId: string;
  run: () => Promise<VideoListItem>;
  resolve: (video: VideoListItem | undefined) => void;
  reject: (err: unknown) => void;
};

// Substitui o p-limit usado antes diretamente na rota: p-limit@3.1.0 não
// permite pular, reordenar ou remover uma tarefa específica da fila interna
// (só existe clearQueue(), que descarta tudo), o que é necessário para
// pausar/retomar/cancelar um job individual ainda em fila.
const pending: QueuedUpload[] = [];
let activeCount = 0;

// O upload real (`uploadVideo`) só é disparado quando o scheduler tira o job
// da fila — enquanto isso a promise devolvida fica pendente. Resolve com
// `undefined` se o job for descartado (cancelado) antes de rodar.
function enqueueUpload(jobId: string, run: () => Promise<VideoListItem>): Promise<VideoListItem | undefined> {
  return new Promise((resolve, reject) => {
    pending.push({ jobId, run, resolve, reject });
    scheduleNext();
  });
}

// Chamado após retomar um job (individual ou em lote) — sem isso, um job
// que estava 'paused' nunca teria uma nova chance de rodar, já que nenhum
// evento de enqueue/conclusão dispararia a varredura de novo.
function notifyQueueChanged(): void {
  scheduleNext();
}

// Remove um job pendente na hora (usado pelo cancelamento), em vez de
// esperar a próxima varredura passar por ele.
function removeFromQueue(jobId: string): void {
  const index = pending.findIndex((entry) => entry.jobId === jobId);
  if (index === -1) return;
  const [entry] = pending.splice(index, 1);
  entry.resolve(undefined);
}

function scheduleNext(): void {
  while (activeCount < config.uploadConcurrencyLimit) {
    const entry = pickNextRunnable();
    if (!entry) return;
    runEntry(entry);
  }
}

// Varre a fila do início: descarta qualquer job já cancelado (nunca vai
// rodar mesmo), pula (sem remover) os pausados, e devolve o primeiro
// 'queued' encontrado — que pode estar atrás de jobs pausados na fila.
function pickNextRunnable(): QueuedUpload | undefined {
  let index = 0;
  while (index < pending.length) {
    const status = getJob(pending[index].jobId)?.status;
    if (status === 'cancelled' || status === undefined) {
      const [discarded] = pending.splice(index, 1);
      discarded.resolve(undefined);
      continue;
    }
    if (status === 'paused') {
      index += 1;
      continue;
    }
    return pending.splice(index, 1)[0];
  }
  return undefined;
}

function runEntry(entry: QueuedUpload): void {
  activeCount += 1;
  startJob(entry.jobId);
  entry
    .run()
    .then(entry.resolve, entry.reject)
    .finally(() => {
      activeCount -= 1;
      scheduleNext();
    });
}

export { enqueueUpload, notifyQueueChanged, removeFromQueue };
