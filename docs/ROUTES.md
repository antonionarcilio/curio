# Referência de rotas

Todas as rotas públicas da aplicação ficam sob o prefixo `/api/v1`.

Toda rota passa pelo middleware `requireToken` (`src/server.ts`). "Privada"
significa que exige `Authorization: Bearer SEU_TOKEN`. "Híbrida" significa que
aceita o header privado ou uma URL assinada com `exp`/`sig`, escopada ao
`chatId`/`messageId` e com expiração de 1h. Veja
[`../README.md`](../README.md#autenticação) para a explicação completa.

As rotas de leitura (`/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`,
`/api/v1/channels`, `/api/v1/channel/:channel_id` e a resolução de metadados
usada por stream/download) usam cache em memória com TTL configurável
(`CACHE_TTL_MS`, default 3 min). Use `POST /api/v1/cache/purge` para forçar
dados frescos.

## Paginação

As listagens aceitam `limit`, `page` e `per_page`:

- `limit` (default `100`) define quantos itens são buscados/considerados.
- `page` / `per_page` ativam o envelope `{ data, page, per_page, total,
  total_pages }`; sem eles, a resposta fica no formato não paginado da rota.
- `per_page` é limitado a `100`. Se só `page` for enviado, `per_page` herda
  `limit`, também limitado a `100`.

`/api/v1/videos/by/:chatId` pagina nativamente quando não há `file_name` nem
`description`; com qualquer um desses filtros, busca até `limit`, filtra em
memória e só então pagina. Em
`/api/v1/videos/grouped` e `/api/v1/channels`, a paginação é em memória.

## `GET /api/v1/channels`

- **Propósito**: lista os canais/supergrupos de que a conta faz parte.
- **Acesso**: Privada.
- **Query params**: `limit`, `channel_id`, `channel_title`, `page`,
  `per_page`.
- **Resposta**: sem paginação, `[{ channel_id, channel_title }]`. Com
  paginação, `{ data, page, per_page, total, total_pages }`.
- **Nomenclatura**: usa `channel_id`/`channel_title` porque só retorna peers
  do tipo `Channel`.

## `GET /api/v1/channel/:channel_id`

- **Propósito**: retorna detalhes básicos de um canal/supergrupo específico.
- **Acesso**: Privada.
- **Path params**: `channel_id`, aceitando o mesmo padrão das rotas por chat:
  ID numérico, `-100...`, `@username` ou outro peer resolvível pela conta.
- **Query params**: nenhum. Esta rota é uma exceção à paginação porque sempre
  retorna exatamente um item.
- **Resposta**: `{ channel_id, channel_title, description, username, type,
  participants_count, admins_count, kicked_count, banned_count, online_count }`.
  `type` é `"channel"` ou `"supergroup"`; campos não informados pelo Telegram
  retornam `null`.
- **Cache**: usa o mesmo TTL das demais rotas de leitura.

## `GET /api/v1/videos/grouped`

- **Propósito**: percorre todos os chats/canais (`getDialogs`) e lista vídeos
  encontrados em cada um, com URL de streaming assinada pronta.
- **Acesso**: Privada.
- **Query params**: `limit`, `chat_id`, `chat_title`, `file_name`,
  `description`, `page`, `per_page`.
- **Resposta**: sem paginação, array de `{ chat_id, chat_title, message_id,
  file_name, size, mime_type, date, description, url }`. Com paginação,
  `{ data, page, per_page, total, total_pages }`.
- **Observação**: `limit` é por chat, não total global; `limit=1` pode retornar
  um item por chat com vídeos.

## `GET /api/v1/videos/by/:chatId`

- **Propósito**: lista vídeos de qualquer peer Telegram aceito por TeleProto:
  canal, grupo, conversa, username ou `"me"` para Saved Messages.
- **Acesso**: Privada.
- **Query params**: `limit`, `file_name`, `description`, `thumbnail` (`true` |
  `false`, default `false`), `page`, `per_page`.
- **Resposta**: sem paginação, `{ chat_id, data: [...] }`. Com paginação,
  `{ chat_id, data, page, per_page, total, total_pages }`.
- **Item em `data`**: `{ message_id, file_name, size, mime_type, date,
  description, duration, width, height, supports_streaming, thumbnail_width,
  thumbnail_height, thumbnail, url }`.
- **Thumbnail**: `thumbnail=true` baixa a thumbnail real do Telegram para os
  itens retornados; falhas por item resultam em `thumbnail: null` sem derrubar
  a resposta.

## `GET /api/v1/video/stream/:chatId/:messageId`

- **Propósito**: serve os bytes do vídeo com suporte a `Range` (`200` ou
  `206`), buscando sob demanda via TeleProto MediaScheduler, sem gravar em
  disco.
- **Acesso**: Híbrida.
- **Query params via URL assinada**: `exp` e `sig`.
- **Resposta**: stream binário com `Content-Disposition: inline` para mime
  types `video/*`; mime type inseguro cai para `application/octet-stream` e
  `attachment`.

## `GET /api/v1/video/dl/:chatId/:messageId`

- **Propósito**: baixa o mesmo vídeo da rota de stream, com suporte a `Range`.
- **Acesso**: Híbrida.
- **Query params via URL assinada**: `exp` e `sig`.
- **Resposta**: stream binário com `Content-Disposition: attachment`.

## `POST /api/v1/video/upload/:chatId`

- **Propósito**: envia um vídeo novo para `chatId`. **Assíncrona**: o envio
  real pro Telegram (`tg.uploadFile`/`tg.sendFile`) pode levar minutos em
  arquivos grandes, então a rota não segura a resposta HTTP até o fim (isso
  estourava o timeout de clientes como o Insomnia) — ela responde assim que o
  arquivo termina de chegar no servidor, e o progresso/resultado final devem
  ser consultados em `GET /api/v1/video/upload/progress/:jobId`.
- **Acesso**: Privada.
- **Corpo**: `multipart/form-data`, em memória:
  - `file` obrigatório, somente `video/*`.
  - `thumbnail` opcional; o Telegram exige JPG pequeno e rejeita valores
    inválidos.
  - `description` opcional, até 1024 caracteres.
  - `filename` opcional; quando informado e não vazio, substitui o nome
    original do arquivo enviado. Se for vazio ou contiver apenas espaços, é
    tratado como ausente. `file_name` na resposta usa o nome escolhido.
- **Concorrência**: no máximo `UPLOAD_CONCURRENCY_LIMIT` uploads reais rodam
  ao mesmo tempo contra a conta Telegram (default `1`, mesma razão de
  `FLOOD_WAIT` que motiva `TELEGRAM_FETCH_CONCURRENCY` nas rotas de leitura).
  Requests além do limite ficam com o job em `queued` até uma vaga abrir.
- **Resposta**: `202 Accepted` imediato, `{ job_id, status: "queued" }`. O
  `job_id` deve ser usado em `GET /api/v1/video/upload/progress/:jobId` para
  acompanhar o andamento e obter o resultado final.

## `GET /api/v1/video/upload/progress/:jobId`

- **Propósito**: consulta o andamento de um upload iniciado por
  `POST /api/v1/video/upload/:chatId`.
- **Acesso**: Privada.
- **Query params**: nenhum.
- **Resposta**: `{ job_id, status, progress }`, onde `status` é
  `"queued" | "paused" | "uploading" | "completed" | "error" | "cancelled"` e
  `progress` é uma fração de `0` a `1` (progresso real do envio ao Telegram,
  via `tg.uploadFile`). Quando `status` é `"completed"`, a resposta também
  inclui `{ chat_id, message_id, file_name, size, mime_type, date, url }` — o
  mesmo formato que a antiga resposta síncrona do upload, com `url`
  apontando para `/api/v1/video/stream/...`. Quando `status` é `"error"`,
  inclui `error` com a mensagem da falha. `"paused"` indica que o job foi
  pausado via `POST /api/v1/video/upload/pause/:jobId` (ou em lote, ver
  abaixo); `"cancelled"` indica que o job foi cancelado via
  `POST /api/v1/video/upload/cancel/:jobId`. Um `job_id` desconhecido ou já
  expirado retorna `404`.
- **Retenção**: o resultado de um job concluído/com erro/cancelado fica
  disponível por `UPLOAD_PROGRESS_TTL_MINUTES` (default 5) antes de ser
  limpo da memória.

## `POST /api/v1/video/upload/cancel/:jobId`

- **Propósito**: cancela um upload iniciado por
  `POST /api/v1/video/upload/:chatId`.
- **Acesso**: Privada.
- **Comportamentos** (não existe forma de abortar `tg.uploadFile`/
  `tg.sendFile` em voo — o GramJS instalado não expõe nenhum
  `AbortController`/signal, só o callback `onProgress`):
  - Job em `queued`: cancelamento imediato, o upload real nunca chega a
    iniciar. Status final: `cancelled`.
  - Job em `uploading`: o envio ao Telegram continua até terminar (soft
    cancel); ao concluir, em vez de responder com o vídeo, o servidor apaga a
    mensagem recém-criada (`deleteVideoMessage`, mesmo helper usado por
    `DELETE /api/v1/video/delete/...`) e o job vai para `cancelled`.
  - Job em `completed`, `error` ou já `cancelled`: `409`, não é possível
    cancelar um job em estado final.
- **Resposta**: `200`, `{ job_id, status }`. `status` é `"cancelled"` (job
  estava `queued`) ou `"uploading"` (cancelamento pendente, aguardando o
  upload em andamento terminar — consulte
  `GET /api/v1/video/upload/progress/:jobId` para ver o desfecho final). Um
  `job_id` desconhecido retorna `404`.

## `POST /api/v1/video/upload/pause/:jobId`

- **Propósito**: pausa um upload que ainda está esperando vaga na fila
  (`status: "queued"`), sem tirá-lo definitivamente da fila. Só é possível
  pausar jobs `queued` — o envio real (`tg.uploadFile`/`tg.sendFile`) não
  pode ser pausado depois de começar, pela mesma razão descrita em
  `POST /api/v1/video/upload/cancel/:jobId`.
- **Acesso**: Privada.
- **Comportamento**: um job `paused` fica de fora da disputa por vagas de
  `UPLOAD_CONCURRENCY_LIMIT` até ser retomado — mesmo que uma vaga abra
  enquanto ele está pausado, jobs atrás dele na fila passam na frente.
- **Resposta**: `200`, `{ job_id, status: "paused" }`. `404` se o `job_id`
  não existe; `409` se o job não estiver em `queued` (já `uploading`,
  `paused`, ou em estado final).

## `POST /api/v1/video/upload/resume/:jobId`

- **Propósito**: retoma um job pausado por
  `POST /api/v1/video/upload/pause/:jobId` (ou pelo bulk abaixo), devolvendo
  ele para `queued` e reconsiderando-o para a próxima vaga livre.
- **Acesso**: Privada.
- **Resposta**: `200`, `{ job_id, status: "queued" }`. `404` se o `job_id`
  não existe; `409` se o job não estiver em `paused`.

## `POST /api/v1/video/upload/pause`

- **Propósito**: pausa, de uma vez, todo job que estiver `queued` no momento
  da chamada. Não é um modo "pausar uploads futuros" — jobs que entrarem na
  fila depois dessa chamada não são afetados.
- **Acesso**: Privada.
- **Resposta**: `200`, `{ paused_job_ids: string[] }` com os `job_id`s
  efetivamente pausados (pode ser `[]` se não havia nenhum `queued`).

## `POST /api/v1/video/upload/resume`

- **Propósito**: retoma, de uma vez, todo job que estiver `paused` no
  momento da chamada.
- **Acesso**: Privada.
- **Resposta**: `200`, `{ resumed_job_ids: string[] }` com os `job_id`s
  efetivamente retomados (pode ser `[]` se não havia nenhum `paused`).

## `PATCH /api/v1/video/update/:chatId/:messageId`

- **Propósito**: edita a legenda/descrição de um vídeo já enviado.
- **Acesso**: Privada.
- **Corpo**: `{ "description": "novo texto" }`, obrigatório, até 1024
  caracteres.
- **Cache**: chama `clearAllCaches()` após sucesso.
- **Resposta**: `{ "edited": true, "chat_id": ..., "message_id": ... }`.

## `DELETE /api/v1/video/delete/:chatId/:messageId`

- **Propósito**: exclui um vídeo já enviado (`revoke: true`).
- **Acesso**: Privada.
- **Cache**: chama `clearAllCaches()` após sucesso.
- **Resposta**: `{ "deleted": true, "chat_id": ..., "message_id": ... }`.

## `POST /api/v1/cache/purge`

- **Propósito**: zera imediatamente o cache em memória usado pelas rotas de
  leitura e pela resolução de metadados de stream/download.
- **Acesso**: Privada.
- **Query params**: nenhum.
- **Resposta**: `{ "purged": true }`.

## Nota sobre edição de arquivo existente

`client.editMessage` do TeleProto só troca texto/arquivo, mas não expõe de forma
segura `attributes` para renomear nem `thumb` para trocar thumbnail de uma
mensagem já existente. Thumbnail deve ser definido no upload; para mudá-lo
depois, seria necessário reenviar o vídeo e perder o `message_id` original.
