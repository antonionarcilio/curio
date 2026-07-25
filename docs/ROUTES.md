# Referência de rotas

Toda rota roda atrás do middleware `requireToken` (`src/server.js`). "Privada"
abaixo significa que exige o header `Authorization: Bearer SEU_TOKEN`.
"Pública (URL assinada)" significa que não precisa de header — mas só é
acessível com um `sig`/`exp` válidos, escopados àquele recurso específico e
com expiração de 1h (nunca é "sem autenticação nenhuma"). Veja
[`../README.md`](../README.md#autenticação) para a explicação completa do
esquema de auth.

Todas as rotas que fazem leitura no Telegram (`/videos`, `/channels`,
`/channels/:channelId/videos`, `/list/:chatId` e a resolução de metadados de
`/video/:chatId/:messageId`) usam um cache em memória com TTL configurável
(`CACHE_TTL_MS`, default 3 min — ver `.env.example`). Chamadas repetidas
dentro da janela de TTL respondem sem round-trip ao Telegram; um vídeo novo
enviado pode levar até esse tempo para aparecer nas listagens.

### Paginação (`/videos`, `/channels`, `/channels/:channelId/videos`, `/list/:chatId`)

Essas quatro rotas aceitam dois pares de query params independentes:

- **`limit`** (default `100`) — quantos itens são buscados/considerados. Em
  `/videos`, `/channels/:channelId/videos` e `/list/:chatId`, é o parâmetro
  `limit` passado direto pra busca nativa de vídeo do Telegram
  (`InputMessagesFilterVideo`). Em `/channels`, é o `limit` passado pro
  `getDialogs` — como o Telegram não tem um filtro nativo de "só canais" (ao
  contrário do filtro de vídeo), esse `limit` conta **diálogos escaneados no
  total** (canais + grupos + conversas), não só canais — então `limit=5` pode
  devolver menos de 5 canais, se nem todos os 5 diálogos mais recentes forem
  canais.
- **`page`** / **`per_page`** (`per_page` até `100`) — cortam a resposta em
  páginas. **Se nenhum dos dois for passado, a resposta é um array plano com
  tudo que foi buscado (respeitando `limit`)** — o modo paginado só é ativado
  quando pelo menos um dos dois vier na query; nesse caso a resposta vira um
  envelope `{ data, page, per_page, total, total_pages }` (`page` default
  `1`). Se só `page` for passado (sem `per_page`), `per_page` assume o valor
  de `limit` (capado em `100`) em vez de um default fixo — ou seja, `limit`
  continua valendo mesmo em modo paginado, a menos que `per_page` seja
  passado explicitamente (esse sempre vence).

Em `/channels/:channelId/videos` e `/list/:chatId` (busca num chat só) a
paginação é **nativa**: usa o filtro de vídeo do próprio Telegram
(`InputMessagesFilterVideo`) com `offsetId`/`addOffset`, então o Telegram já
devolve exatamente a página pedida — `total`/`total_pages` vêm da contagem
real do Telegram, não de uma estimativa. Isso também substituiu a antiga
varredura de "últimas 100/200 mensagens cruas": agora cobre o histórico de
vídeos de verdade do chat, não só uma janela de mensagens recentes.

Em `/videos` (agregada, todos os chats) não existe paginação nativa possível
— não há uma chamada do Telegram que pagine "todos os vídeos de todos os
chats" com um cursor global. A busca continua trazendo até `limit` vídeos
por chat (nativamente, em paralelo, cacheada); quando `page`/`per_page` são
usados, o corte é feito em memória sobre o array já agregado e filtrado —
reduz o tamanho da resposta, mas não o número de chamadas ao Telegram.
`/channels` segue o mesmo corte em memória sobre a lista de diálogos já
buscada (nativamente limitada por `limit`, ver acima).

## `GET /routes`

- **Propósito**: lista todas as rotas registradas no servidor (introspecção de
  `router.stack` em tempo de execução — nunca fica desatualizada).
- **Acesso**: Privada.
- **Query params**: nenhum.
- **Resposta**: `[{ "method": "GET", "path": "/videos" }, ...]`

## `GET /videos`

- **Propósito**: percorre todos os seus chats/canais (`getDialogs`) e lista os
  vídeos encontrados em cada um, já com a URL de streaming pronta (assinada).
  A busca por chat é paralelizada (até `TELEGRAM_FETCH_CONCURRENCY` chats
  simultâneos, default 5) em vez de sequencial.
- **Acesso**: Privada.
- **Query params**:
  - `limit` (opcional, default `100`) — máximo de vídeos por chat.
  - `chat_id` (opcional) — filtra por correspondência exata do ID do chat.
  - `chat_title` (opcional) — filtra por `chat_title` contendo o termo
    (case-insensitive e sem diferenciar acentos, ex: `chat_title=anto` casa
    com "Antônio", "antoine" etc.).
  - `file_name` (opcional) — mesmo tipo de filtro acima, aplicado a
    `file_name`.
  - Quando mais de um filtro é informado, todos precisam bater (AND).
  - `page` / `per_page` (opcionais) — ver "Paginação" acima. Corte em
    memória, não nativo (ver motivo acima).
- **Resposta**: sem `page`/`per_page`, array de `{ chat_id, chat_title,
  message_id, file_name, size, mime_type, date, url }`. Com `page`/`per_page`,
  `{ data: [...mesmos itens...], page, per_page, total, total_pages }`.

## `GET /channels`

- **Propósito**: lista os canais/supergrupos de que você faz parte.
- **Acesso**: Privada.
- **Query params**:
  - `limit` (opcional, default `100`) — limita diálogos escaneados no total
    (não só canais); filtra em memória sobre a lista já buscada.
  - `channel_id` (opcional) — filtra por correspondência exata do ID do
    canal (compara só os dígitos, então o `-` do ID é irrelevante — `-100...`
    ou `100...` casam igual).
  - `channel_title` (opcional) — filtra por `channel_title` contendo o termo
    (case-insensitive e sem diferenciar acentos, ex: `channel_title=tec` casa
    com "Tecnoblog", "Canaltech", "TecMundo" etc.).
  - Quando os dois filtros são informados, ambos precisam bater (AND).
  - `page` / `per_page` (opcionais) — ver "Paginação" acima. Paginação
    aplicada em memória sobre a lista já buscada.
- **Resposta**: sem `page`/`per_page`, `[{ "channel_id": "...",
  "channel_title": "..." }, ...]`. Com `page`/`per_page`, `{ data:
  [...mesmos itens...], page, per_page, total, total_pages }`.
- **Nomenclatura**: esta rota (e `/channels/:channelId/videos`, abaixo) usa
  `channel_id`/`channel_title`, não `chat_id`/`chat_title` — porque só lida
  com peers do tipo `Channel` (GramJS: `dialog.isChannel`), nunca grupos
  comuns, chats privados ou "Saved Messages". As demais rotas (`/videos`,
  `/list/:chatId`) podem apontar pra qualquer tipo de diálogo, por isso
  continuam usando `chat_id`/`chat_title`.

## `GET /channels/:channelId/videos`

- **Propósito**: lista os vídeos de um canal específico.
- **Acesso**: Privada.
- **Query params**:
  - `limit` (opcional, default `100`).
  - `file_name` (opcional) — filtra por `file_name` contendo o termo
    (case-insensitive e sem diferenciar acentos).
  - `thumbnail` (opcional, default `false`) — `true` | `false`, ver
    "Thumbnail e metadados do vídeo" abaixo.
  - `page` / `per_page` (opcionais) — ver "Paginação" acima.
- **Paginação nativa, exceto com `file_name`**: sem filtro de texto, cada
  página é buscada direto do Telegram (`total`/`total_pages` vêm da contagem
  real dele). Com `file_name`, a busca precisa olhar todo o conjunto (até
  `limit`) antes de filtrar e paginar — nesse caso o corte de página passa a
  ser em memória sobre o resultado filtrado, senão a busca não encontraria
  vídeos fora da janela de uma única página nativa.
- **Resposta**: sem `page`/`per_page`, `{ channel_id, channel_title, data: [{
  message_id, file_name, size, mime_type, date, description, duration, width,
  height, supports_streaming, thumbnail_width, thumbnail_height, thumbnail,
  url }] }`. Com `page`/`per_page`, `{ channel_id, channel_title, data:
  [...mesmos itens...], page, per_page, total, total_pages }`.
- **Thumbnail e metadados do vídeo**: esta é a única rota de listagem que
  devolve os campos extras acima — `/videos` e `/list/:chatId` mantêm o shape
  enxuto (`message_id, file_name, size, mime_type, date`). `duration` (em
  segundos), `width`, `height` e `supports_streaming` vêm do
  `DocumentAttributeVideo`; `description` é a caption da mensagem;
  `thumbnail_width`/`thumbnail_height` são as dimensões da maior thumbnail que
  o Telegram tem pro vídeo (`null` se o vídeo não tiver nenhuma). Campos que o
  Telegram não informa voltam `null` (`supports_streaming` volta `false`).
  O campo `thumbnail` em si (um data URI JPEG com a imagem) só é preenchido
  quando `?thumbnail=true` é passado — por padrão (`thumbnail=false` ou
  omitido) ele vem `null`, sem nenhum download extra do Telegram. Quando
  `true`, cada item causa um download real (`downloadMedia` pela maior
  `PhotoSize`), paralelizado por `TELEGRAM_FETCH_CONCURRENCY` e cacheado por
  `CACHE_TTL_MS` (purgável via `POST /cache/purge`); se o download de um item
  falhar, aquele item simplesmente fica com `thumbnail: null` em vez de
  derrubar a resposta inteira. Thumbnails são resolvidas só pros itens que
  entram na resposta — nunca pra lista inteira quando uma página foi pedida,
  igual às URLs assinadas.

## `GET /list/:chatId`

- **Propósito**: lista vídeos de qualquer chat (não só canais) por `chatId` —
  útil pra descobrir o `messageId` de um vídeo em "Saved Messages" (`chatId
  = me`) ou em qualquer conversa.
- **Acesso**: Privada.
- **Query params**:
  - `limit` (opcional, default `100`).
  - `page` / `per_page` (opcionais) — ver "Paginação" acima. Paginação
    nativa, igual `/channels/:channelId/videos`.
- **Resposta**: sem `page`/`per_page`, array de `{ message_id, file_name,
  size, mime_type, date }` (sem `url` — essa rota é só pra descoberta, sem o
  wrapper de canal). Com `page`/`per_page`, `{ data: [...mesmos itens...],
  page, per_page, total, total_pages }`. Sem os metadados extras
  (`thumbnail`, `duration`, …) de `/channels/:channelId/videos`: as duas rotas
  compartilham o mesmo fetch/cache, mas esta projeta o item de volta pro shape
  enxuto (`pickBaseVideoFields`, em `src/routes/video-fields.ts`).

## `GET /video/:chatId/:messageId`

- **Propósito**: rota de streaming de fato — serve os bytes do vídeo com
  suporte a `Range` (206 Partial Content), buscando sob demanda do Telegram
  via `iterDownload`, sem baixar o arquivo inteiro em disco.
- **Acesso**: Híbrida — aceita **Privada** (header `Authorization`) **ou
  Pública (URL assinada)** via `?exp=...&sig=...`. É a única rota que aceita
  o segundo modo, porque precisa ser abrível direto por VLC/`<video src>`/
  navegador, que não anexam headers customizados numa navegação simples.
- **Query params**:
  - `exp` (obrigatório via signed URL) — timestamp Unix de expiração.
  - `sig` (obrigatório via signed URL) — HMAC-SHA256 de `chatId:messageId:exp`
    (ver `src/signedUrl.js`).
  - Gerados automaticamente pelas rotas `/videos` e `/channels/:channelId/videos`;
    não monte esse par manualmente.
- **Cache**: a resolução de metadados do vídeo (mensagem/documento) é
  cacheada por `chatId:messageId` — Range requests subsequentes no mesmo
  vídeo (seeks do player) não repetem o lookup no Telegram. Os bytes em si
  (`iterDownload`) nunca são cacheados, sempre buscados ao vivo.
- **Resposta**: stream binário do vídeo (`200` ou `206`), não JSON.

## `POST /video/:chatId`

- **Propósito**: envia um vídeo novo para `chatId` (aceita `"me"` pra Saved
  Messages, igual às rotas de leitura). É a única das três rotas de escrita
  abaixo que permite controlar nome de arquivo e thumbnail — ver a nota
  "Por que não dá pra renomear/trocar thumbnail de um vídeo existente" mais
  abaixo pra entender o motivo dessa rota existir separada de `PATCH`.
- **Acesso**: Privada.
- **Corpo**: `multipart/form-data`, sem gravação em disco (tudo em memória):
  - `file` (obrigatório) — o arquivo de vídeo. Só `video/*` é aceito.
  - `thumbnail` (opcional) — imagem de thumbnail. Sem validação própria de
    dimensão/tamanho no servidor — o Telegram exige jpg, <20KB, <=320x320px
    e rejeita o que não bater; o erro dele propaga como `500`.
  - `file_name` (opcional) — nome customizado do arquivo; se omitido, usa o
    nome original do arquivo enviado.
  - `description` (opcional, até 1024 caracteres) — vira a legenda do vídeo.
- **Cache**: chama `clearAllCaches()` após um envio bem-sucedido, pra que o
  vídeo novo apareça imediatamente em `/videos`, `/list/:chatId`, etc., sem
  esperar o TTL expirar.
- **Resposta**: `{ chat_id, message_id, file_name, size, mime_type, date, url }`
  — `url` já vem como a mesma URL assinada (`createSignedUrl`) que `/videos`
  e `/channels/:channelId/videos` geram, pronta pra tocar o vídeo recém
  enviado sem uma segunda chamada.

## `PATCH /video/:chatId/:messageId`

- **Propósito**: edita a legenda/descrição de um vídeo já enviado.
- **Acesso**: Privada.
- **Corpo**: `{ "description": "novo texto" }` (obrigatório, até 1024
  caracteres — limite de caption do Telegram para contas não-premium).
- **Cache**: chama `clearAllCaches()` após uma edição bem-sucedida.
- **Resposta**: `{ "edited": true, "chat_id": ..., "message_id": ... }`.
- **Erros**: `404` com `{ "error": message }` se a mensagem não existir ou
  não puder ser editada.

## `DELETE /video/:chatId/:messageId`

- **Propósito**: exclui um vídeo já enviado (`revoke: true` — some pra todos
  os participantes do chat, não só localmente).
- **Acesso**: Privada.
- **Cache**: chama `clearAllCaches()` após uma exclusão bem-sucedida.
- **Resposta**: `{ "deleted": true, "chat_id": ..., "message_id": ... }`.
- **Erros**: `404` com `{ "error": message }` se a mensagem não existir.

### Por que não dá pra renomear/trocar thumbnail de um vídeo existente

`client.editMessage` do GramJS só substitui os bytes do arquivo
(`file`/`forceDocument`) — não aceita `attributes` (nome customizado) nem
`thumb` (thumbnail), mesmo a função interna que ele usa por baixo dos panos
aceitando os dois. Não existe hoje nenhuma forma de mudar nome ou thumbnail
de uma mensagem já existente sem excluir e reenviar (o que perderia o
`message_id` original e a posição na conversa — rejeitado como opção) ou sem
depender de funções internas não documentadas do pacote (risco de quebrar em
atualizações futuras — também rejeitado). Por isso esses dois campos só
podem ser definidos no momento do `POST /video/:chatId` (upload), nunca via
`PATCH` de um vídeo já existente.

## `POST /cache/purge`

- **Propósito**: zera imediatamente todo o cache em memória usado pelas
  rotas de leitura (`/videos`, `/channels`, `/channels/:channelId/videos`,
  `/list/:chatId`, e a resolução de metadados de
  `/video/:chatId/:messageId`) — a próxima chamada a qualquer uma delas busca
  dados frescos do Telegram, ignorando o TTL (`CACHE_TTL_MS`) ainda em vigor.
  Útil pra forçar atualização depois de enviar um vídeo novo sem esperar o
  TTL expirar, sem precisar reiniciar o servidor.
- **Acesso**: Privada.
- **Query params**: nenhum.
- **Resposta**: `{ "purged": true }`.
