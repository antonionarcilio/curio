# Referência de rotas

Todas as rotas públicas da aplicação ficam sob o prefixo `/api/v1`.

Toda rota passa pelo middleware `requireToken` (`src/server.ts`). "Privada"
significa que exige `Authorization: Bearer SEU_TOKEN`. "Híbrida" significa que
aceita o header privado ou uma URL assinada com `exp`/`sig`, escopada ao
`chatId`/`messageId` e com expiração de 1h. Veja
[`../README.md`](../README.md#autenticação) para a explicação completa.

As rotas de leitura (`/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`,
`/api/v1/channels` e a resolução de metadados usada por stream/download)
usam cache em memória com TTL configurável (`CACHE_TTL_MS`, default 3 min).
Use `POST /api/v1/cache/purge` para forçar dados frescos.

## Paginação

As listagens aceitam `limit`, `page` e `per_page`:

- `limit` (default `100`) define quantos itens são buscados/considerados.
- `page` / `per_page` ativam o envelope `{ data, page, per_page, total,
  total_pages }`; sem eles, a resposta fica no formato não paginado da rota.
- `per_page` é limitado a `100`. Se só `page` for enviado, `per_page` herda
  `limit`, também limitado a `100`.

`/api/v1/videos/by/:chatId` pagina nativamente quando não há `file_name`; com
`file_name`, busca até `limit`, filtra em memória e só então pagina. Em
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

## `GET /api/v1/videos/grouped`

- **Propósito**: percorre todos os chats/canais (`getDialogs`) e lista vídeos
  encontrados em cada um, com URL de streaming assinada pronta.
- **Acesso**: Privada.
- **Query params**: `limit`, `chat_id`, `chat_title`, `file_name`, `page`,
  `per_page`.
- **Resposta**: sem paginação, array de `{ chat_id, chat_title, message_id,
  file_name, size, mime_type, date, url }`. Com paginação, `{ data, page,
  per_page, total, total_pages }`.
- **Observação**: `limit` é por chat, não total global; `limit=1` pode retornar
  um item por chat com vídeos.

## `GET /api/v1/videos/by/:chatId`

- **Propósito**: lista vídeos de qualquer peer Telegram aceito por GramJS:
  canal, grupo, conversa, username ou `"me"` para Saved Messages.
- **Acesso**: Privada.
- **Query params**: `limit`, `file_name`, `thumbnail` (`true` | `false`,
  default `false`), `page`, `per_page`.
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
  `206`), buscando sob demanda via `client.iterDownload`, sem gravar em disco.
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

- **Propósito**: envia um vídeo novo para `chatId`.
- **Acesso**: Privada.
- **Corpo**: `multipart/form-data`, em memória:
  - `file` obrigatório, somente `video/*`.
  - `thumbnail` opcional; o Telegram exige JPG pequeno e rejeita valores
    inválidos.
  - `file_name` opcional.
  - `description` opcional, até 1024 caracteres.
- **Cache**: chama `clearAllCaches()` após sucesso.
- **Resposta**: `{ chat_id, message_id, file_name, size, mime_type, date,
  url }`, com `url` apontando para `/api/v1/video/stream/...`.

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

`client.editMessage` do GramJS só troca texto/arquivo, mas não expõe de forma
segura `attributes` para renomear nem `thumb` para trocar thumbnail de uma
mensagem já existente. Nome customizado e thumbnail devem ser definidos no
upload; para mudar esses dados depois, seria necessário reenviar o vídeo e
perder o `message_id` original.
