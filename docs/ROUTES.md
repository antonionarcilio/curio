# Referência de rotas

Toda rota roda atrás do middleware `requireToken` (`src/server.js`). "Privada"
abaixo significa que exige o header `Authorization: Bearer SEU_TOKEN`.
"Pública (URL assinada)" significa que não precisa de header — mas só é
acessível com um `sig`/`exp` válidos, escopados àquele recurso específico e
com expiração de 1h (nunca é "sem autenticação nenhuma"). Veja
[`../README.md`](../README.md#autenticação) para a explicação completa do
esquema de auth.

Todas as rotas que fazem leitura no Telegram (`/videos`, `/channels`,
`/channels/:chatId/videos`, `/list/:chatId` e a resolução de metadados de
`/video/:chatId/:messageId`) usam um cache em memória com TTL configurável
(`CACHE_TTL_MS`, default 3 min — ver `.env.example`). Chamadas repetidas
dentro da janela de TTL respondem sem round-trip ao Telegram; um vídeo novo
enviado pode levar até esse tempo para aparecer nas listagens.

### Paginação (`/videos`, `/channels`, `/channels/:chatId/videos`, `/list/:chatId`)

Essas quatro rotas aceitam dois pares de query params independentes:

- **`limit`** (default `100`) — quantos itens são buscados/considerados. Em
  `/videos`, `/channels/:chatId/videos` e `/list/:chatId`, é o parâmetro
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

Em `/channels/:chatId/videos` e `/list/:chatId` (busca num chat só) a
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
- **Query params**: `limit` (opcional, default `100`); `page` / `per_page`
  (opcionais) — ver "Paginação" acima. `limit` limita diálogos escaneados no
  total (não só canais); a paginação em si é corte em memória sobre a lista
  já filtrada.
- **Resposta**: sem `page`/`per_page`, `[{ "chat_id": "...", "chat_title":
  "..." }, ...]`. Com `page`/`per_page`, `{ data: [...mesmos itens...], page,
  per_page, total, total_pages }`.

## `GET /channels/:chatId/videos`

- **Propósito**: lista os vídeos de um canal específico.
- **Acesso**: Privada.
- **Query params**: `limit` (opcional, default `100`); `page` / `per_page`
  (opcionais) — ver "Paginação" acima. Paginação nativa: cada página é
  buscada direto do Telegram, não cortada de uma lista maior já em memória.
- **Resposta**: sem `page`/`per_page`, `{ chat_id, chat_title, data: [{
  message_id, file_name, size, mime_type, date, url }] }`. Com
  `page`/`per_page`, `{ chat_id, chat_title, data: [...mesmos itens...],
  page, per_page, total, total_pages }` — `total`/`total_pages` vêm da
  contagem real do Telegram para aquele chat.

## `GET /list/:chatId`

- **Propósito**: lista vídeos de qualquer chat (não só canais) por `chatId` —
  útil pra descobrir o `messageId` de um vídeo em "Saved Messages" (`chatId
  = me`) ou em qualquer conversa.
- **Acesso**: Privada.
- **Query params**: `limit` (opcional, default `100`); `page` / `per_page`
  (opcionais) — ver "Paginação" acima. Paginação nativa, igual
  `/channels/:chatId/videos`.
- **Resposta**: sem `page`/`per_page`, array de `{ message_id, file_name,
  size, mime_type, date }` (sem `url` — essa rota é só pra descoberta, sem o
  wrapper de canal). Com `page`/`per_page`, `{ data: [...mesmos itens...],
  page, per_page, total, total_pages }`.

## `GET /video/:chatId/:messageId`

- **Propósito**: rota de streaming de fato — serve os bytes do vídeo com
  suporte a `Range` (206 Partial Content), buscando sob demanda do Telegram
  via `iterDownload`, sem baixar o arquivo inteiro em disco.
- **Acesso**: Híbrida — aceita **Privada** (header `Authorization`) **ou
  Pública (URL assinada)** via `?exp=...&sig=...`. É a única rota que aceita
  o segundo modo, porque precisa ser abrível direto por VLC/`<video src>`/
  navegador, que não anexam headers customizados numa navegação simples.
- **Query params**: `exp` (timestamp Unix de expiração) e `sig` (HMAC-SHA256
  de `chatId:messageId:exp`, ver `src/signedUrl.js`) — gerados
  automaticamente pelas rotas `/videos` e `/channels/:chatId/videos`; não
  monte esse par manualmente.
- **Cache**: a resolução de metadados do vídeo (mensagem/documento) é
  cacheada por `chatId:messageId` — Range requests subsequentes no mesmo
  vídeo (seeks do player) não repetem o lookup no Telegram. Os bytes em si
  (`iterDownload`) nunca são cacheados, sempre buscados ao vivo.
- **Resposta**: stream binário do vídeo (`200` ou `206`), não JSON.
