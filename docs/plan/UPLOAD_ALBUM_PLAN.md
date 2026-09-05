# Upload agrupado (álbum) no Telegram

## Contexto

O usuário quer poder enviar vários vídeos de uma vez agrupados como "álbum"
do Telegram (uma mensagem-grupo com `grouped_id` compartilhado, como o app
faz ao selecionar múltiplos arquivos), ativado **automaticamente** quando o
request traz mais de um arquivo — sem novo query param.

Investigação confirmou que `teleproto` já suporta isso nativamente: se `file`
passado a `sendFile` é um **array**, a lib delega para `_sendAlbum`
(`client/uploads.js`), que faz upload de cada item e dispara uma única
`Api.messages.SendMultiMedia`. Porém **não há chunking automático** — o
array inteiro vai numa única chamada, sem respeitar o limite de **10 itens
por álbum** do Telegram. Isso precisa ser feito por nós.

**Este plano foi revisado** depois de constatar que o pipeline de upload
mudou bastante desde a primeira leitura (o projeto passou por várias
melhorias recentes: fila com pausar/retomar/cancelar, `upload-scheduler.ts`,
`upload-job-settlement.ts`). O plano abaixo já está desenhado em cima do
estado atual do código, não da versão antiga.

## Estado atual (confirmado por leitura direta, não por memória)

- `src/routes/video/upload/route.ts`: multer com `file` limitado a
  `maxCount: 1`; monta `jobId`, chama `createJob`, responde `202` na hora, e
  dispara `enqueueUpload(jobId, () => uploadVideo(...))` em background,
  encadeando `.then(video => settleUploadJob(jobId, chatId, base, video))`.
- `src/telegram-client.ts` `uploadVideo` (linhas 423–511): recebe um único
  `buffer`/`originalFileName`, faz `tg.uploadFile` de um `CustomFile` e um
  único `tg.sendFile(chatId, { file: uploadedFile, ... })`. Nenhum uso de
  `Api.messages.SendMultiMedia` hoje.
- `src/services/videos/upload-scheduler.ts`: fila própria (substituiu
  `p-limit` direto na rota) com `enqueueUpload`/`removeFromQueue`/
  `notifyQueueChanged`, respeitando `UPLOAD_CONCURRENCY_LIMIT` e pulando jobs
  `paused` sem tirá-los da fila.
- `src/services/videos/upload-job-settlement.ts` `settleUploadJob`: decide o
  desfecho pós-upload — se um cancelamento foi pedido durante `uploading`,
  apaga a mensagem recém-criada (`deleteVideoMessage(chatId, video.message_id)`,
  **um único id**) em vez de completar o job com sucesso.
- `src/services/upload-progress-store.ts`: `UploadJobStatus = 'queued' |
  'paused' | 'uploading' | 'completed' | 'error' | 'cancelled'`;
  `UploadJob.result` é hoje um objeto único (`VideoListItem & { url }`).
  `pauseJob`/`resumeJob` só afetam jobs em `queued`; `requestCancel` finaliza
  na hora jobs `queued`/`paused`, ou marca `cancelRequested` num job
  `uploading` para o settlement decidir depois.
- Rotas relacionadas já existentes: `upload-cancel/`, `upload-pause/`,
  `upload-pause-all/`, `upload-progress/`, `upload-resume/`,
  `upload-resume-all/` — todas operam sobre um `jobId`/um vídeo por vez.
- Nenhum código de álbum/lote/`SendMultiMedia` existe hoje em lugar nenhum do
  repositório.

## Decisões tomadas com o usuário (para fechar o escopo)

1. **Cancelamento parcial de álbum**: se o job for cancelado enquanto alguns
   chunks de 10 já viraram mensagens reais no Telegram, **apagar tudo que já
   foi enviado** (todos os `message_id`s dos chunks concluídos), não deixar
   parte do álbum publicada.
2. **Formato de `UploadJob.result`**: passa a ser **sempre um array**
   (`(VideoListItem & { url })[]`), inclusive para upload de um único
   arquivo — **isso é uma mudança de contrato JSON**, quebra qualquer cliente
   que hoje espera um objeto na rota de progress. Precisa ser destacado como
   breaking change na documentação e (se relevante) versionado/anunciado.
3. **Escopo**: implementar tudo de uma vez — progresso agregado, chunking de
   10, cancelamento parcial com limpeza de múltiplas mensagens, e pausar/
   retomar reaproveitando a semântica atual (só afeta jobs ainda `queued`,
   sem mudança de comportamento aí, já que álbum ainda é "um job" na fila).

## Abordagem

Estender a rota existente (`POST /api/v1/video/upload/:chatId`) em vez de
criar uma rota separada — a diferença real é: aceitar múltiplos arquivos,
fatiar em chunks de 10, mandar cada chunk como `sendFile(array)`, e agregar
progresso/resultado/cancelamento entre chunks.

### 1. `src/routes/video/upload/route.ts`

- Multer: trocar `{ name: 'file', maxCount: 1 }` para um `maxCount` alto
  (ex. 50 — chunking de 10 acontece na camada de serviço, não aqui).
- `files?.file` passa a ser `Express.Multer.File[]` com 1..N itens; manter
  validação de "obrigatório" (`length === 0` → 400) e `SAFE_MIME_TYPE` para
  **cada** arquivo do array.
- Chamar sempre a mesma função de serviço nova (`uploadVideoBatch`, ver
  abaixo), passando o array completo — mesmo com 1 item, para que `result`
  já saia como array desde o dia 1 (unifica os dois caminhos, evita bifurcar
  lógica só por causa da quantidade).
- `thumbnail` continua único (`maxCount: 1`) — aplicado apenas ao primeiro
  item/primeiro chunk, mesma limitação que a lib já impõe pra caption única.

### 2. Nova função em `src/telegram-client.ts`: `uploadVideoBatch`

- Assinatura: recebe um array de
  `{ buffer, originalFileName, description?, thumbnailBuffer? }` + um
  `onProgress?(progress: number)` agregando bytes de todos os itens, e um
  `isCancelRequested?(): boolean` (ou equivalente) para checar entre chunks
  se deve parar de enviar os restantes.
- Fatiar em grupos de até 10 (`chunkArray(files, 10)`), e para cada grupo:
  - Upload de bytes por item via `tg.uploadFile` (reaproveitando
    `CustomFile`/`probeVideoMetadata`/`MAX_UPLOAD_SIZE_BYTES` como hoje).
  - Se o grupo tiver mais de 1 item: `tg.sendFile(chatId, { file: [...uploadedFiles], attributes: [...], caption, forceDocument: false, supportsStreaming: true })`
    — array ativa `_sendAlbum`/`SendMultiMedia` internamente.
  - Se o grupo tiver exatamente 1 item (ex. batch de 1, ou resto de uma
    divisão que sobra sozinho): manter o `sendFile` com arquivo único, igual
    hoje — evita forçar um "álbum de 1" artificialmente.
  - Entre chunks, checar `isCancelRequested()`: se true, parar de processar
    chunks restantes e devolver **apenas os `VideoListItem`s já enviados**
    até aquele ponto (a limpeza de mensagens já enviadas fica a cargo do
    settlement, não desta função — mantém a função sem side-effect de
    "desfazer").
- Retorno: `VideoListItem[]` (uma entrada por vídeo efetivamente enviado).
- `clearAllCaches()` ao final, igual `uploadVideo` hoje.
- Decisão de implementação: `uploadVideo` (singular) pode ser mantida como
  está e usada internamente por `uploadVideoBatch` para o caso de 1 arquivo,
  evitando duplicar a montagem de `attributes`/`CustomFile`.

### 3. `src/services/videos/upload-job-settlement.ts`

- `settleUploadJob` precisa aceitar `video: VideoListItem[]` em vez de um
  único item.
- Se cancelamento foi pedido: apagar **todos** os `message_id`s do array
  (loop de `deleteVideoMessage`, ou uma função nova `deleteVideoMessages`
  em lote se o volume justificar) antes de `finalizeCancelledJob`.
- Se não: `completeJob(jobId, videos.map(v => ({ ...v, url: createSignedUrl(base, chatId, v.message_id) })))`.

### 4. `src/services/upload-progress-store.ts`

- `UploadJob.result` muda de `VideoListItem & { url }` para
  `(VideoListItem & { url })[]`.
- Nenhuma mudança de status/lifecycle necessária — `pauseJob`/`resumeJob`/
  `requestCancel` continuam operando no nível do job inteiro, sem noção de
  "por item", o que já cobre a decisão 3 acima.

### 5. Documentação

- `docs/ROUTES.md`:
  - `POST /api/v1/video/upload/:chatId`: documentar que `file` aceita
    múltiplos arquivos, modo álbum automático quando `file.length > 1`,
    limite de 10 por álbum do Telegram e chunking automático.
  - `GET /api/v1/video/upload/progress/:jobId`: **destacar como breaking
    change** que `result` agora é sempre array, mesmo para upload único.
  - `POST /api/v1/video/upload/cancel/:jobId`: mencionar que, para um job de
    lote parcialmente enviado, o cancelamento apaga todas as mensagens já
    publicadas (não só a mais recente).
- `docs/insomnia/Insomnia.yaml`: espelhar as mesmas mudanças de descrição na
  mesma sessão (convenção do projeto).

### 6. Testes (TDD)

- `test/unit/telegram-client.unit.test.ts`: casos para `uploadVideoBatch`
  cobrindo: 1 item (delega pra `sendFile` single, sem array), ≤10 itens (uma
  chamada `sendFile` com array), >10 itens (múltiplas chamadas/chunks),
  cancelamento pedido no meio (para de processar chunks restantes e retorna
  só o que já foi enviado).
- `test/int/routes/video/upload/route.int.test.ts`: caso com múltiplos
  arquivos no campo `file`, mockando `@/telegram-client` pra verificar que
  `uploadVideoBatch` é chamada com o array completo.
- `test/unit/services/videos/upload-job-settlement.unit.test.ts` (ou onde já
  existir): atualizar para `video: VideoListItem[]`, cobrindo o caso de
  cancelamento apagando múltiplos `message_id`s.
- Atualizar qualquer teste existente que hoje assume `result` como objeto
  único (rota de progress) para o novo formato array.
- Rodar `npx pnpm test:coverage` ao final, mínimo 90%.

## Pontos em aberto para decidir durante a implementação (não bloqueiam o plano)

- Progresso agregado exato: média simples entre chunks vs. ponderada por
  bytes totais do lote inteiro. Sugestão: ponderada por bytes (mais preciso
  para arquivos de tamanhos muito diferentes).
- Falha em um item no meio de um chunk (não cancelamento, erro real): manter
  postura "tudo ou nada" do upload único hoje (falha o job inteiro) — chunks
  já enviados com sucesso antes do erro ficam publicados (não há rollback
  automático nesse caso, diferente do cancelamento explícito). Confirmar
  isso é aceitável ou se precisa do mesmo "apagar tudo" do cancelamento.

## Verificação

- `npx pnpm test:unit` e `npx pnpm test:int` cobrindo os novos casos.
- `npx pnpm typecheck` e `npx pnpm lint`.
- `npx pnpm test:coverage` ≥ 90% em todas as métricas.
- Teste manual via Insomnia/curl: enviar 2-3 arquivos pequenos no campo
  `file` contra `"me"` (Saved Messages), confirmar no app do Telegram que
  chegaram agrupados (mesmo `grouped_id`), e testar cancelamento no meio de
  um lote maior (>10 itens) para confirmar que as mensagens já enviadas são
  removidas.
