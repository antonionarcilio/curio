import type { UploadJobStatus } from '@/services/create-upload-job-store';

type QueuedUpload<TResult> = {
  jobId: string;
  run: () => Promise<TResult>;
  resolve: (result: TResult | undefined) => void;
  reject: (err: unknown) => void;
};

// O scheduler só precisa consultar o status de um job e marcá-lo como
// 'uploading' — não o `TResult` armazenado no job-store (que só existe
// depois da liquidação/settlement, com a URL assinada já anexada). Por isso
// essa leitura é estruturalmente independente do TResult do job-store: um
// UploadJobStore<QualquerCoisa> satisfaz essa interface, sem precisar
// coincidir com o TResult que o scheduler devolve via `run()`.
type JobStatusReader = {
  getJob: (jobId: string) => { status: UploadJobStatus } | undefined;
  startJob: (jobId: string) => void;
};

// Fábrica de scheduler: cada mídia (vídeo, áudio) instancia a sua própria,
// com uma fila `pending`/`activeCount` privados à instância e seu próprio
// limite de concorrência — um upload de uma mídia nunca ocupa a vaga da
// outra. Substitui o p-limit usado antes diretamente na rota: p-limit@3.1.0
// não permite pular, reordenar ou remover uma tarefa específica da fila
// interna (só existe clearQueue(), que descarta tudo), o que é necessário
// para pausar/retomar/cancelar um job individual ainda em fila.
export function createUploadScheduler<TResult>({
  concurrencyLimit,
  store,
}: {
  concurrencyLimit: number;
  store: JobStatusReader;
}) {
  const pending: QueuedUpload<TResult>[] = [];
  let activeCount = 0;

  // O upload real só é disparado quando o scheduler tira o job da fila —
  // enquanto isso a promise devolvida fica pendente. Resolve com `undefined`
  // se o job for descartado (cancelado) antes de rodar.
  function enqueueUpload(jobId: string, run: () => Promise<TResult>): Promise<TResult | undefined> {
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
    while (activeCount < concurrencyLimit) {
      const entry = pickNextRunnable();
      if (!entry) return;
      runEntry(entry);
    }
  }

  // Varre a fila do início: descarta qualquer job já cancelado (nunca vai
  // rodar mesmo), pula (sem remover) os pausados, e devolve o primeiro
  // 'queued' encontrado — que pode estar atrás de jobs pausados na fila.
  function pickNextRunnable(): QueuedUpload<TResult> | undefined {
    let index = 0;
    while (index < pending.length) {
      const status = store.getJob(pending[index].jobId)?.status;
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

  function runEntry(entry: QueuedUpload<TResult>): void {
    activeCount += 1;
    store.startJob(entry.jobId);
    entry
      .run()
      .then(entry.resolve, entry.reject)
      .finally(() => {
        activeCount -= 1;
        scheduleNext();
      });
  }

  return { enqueueUpload, notifyQueueChanged, removeFromQueue };
}

export type UploadScheduler<TResult> = ReturnType<typeof createUploadScheduler<TResult>>;
