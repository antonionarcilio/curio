# Configuração (variáveis de ambiente)

Todas as variáveis são lidas de `.env` (via `dotenv`) e validadas com zod em
`src/config.ts`. **Configuração de ambiente inválida derruba o processo na
subida** (fail fast). O modelo de referência é o arquivo
[`.env.sample`](../.env.sample).

## Obrigatórias

| Variável             | Descrição                                                                 |
| -------------------- | ------------------------------------------------------------------------- |
| `TELEGRAM_API_ID`    | Criado em https://my.telegram.org → "API Development Tools". Deve ser numérico. |
| `TELEGRAM_API_HASH`  | Criado junto com o `TELEGRAM_API_ID`, no mesmo lugar.                      |
| `ACCESS_TOKEN`       | Senha simples que protege todas as rotas do servidor (ver [`AUTH.md`](AUTH.md)). |

## Opcionais

| Variável                     | Default        | Descrição                                                                 |
| ---------------------------- | -------------- | ------------------------------------------------------------------------- |
| `TELEGRAM_SESSION`           | `""`           | String gerada por `npm run login`; evita logar de novo a cada execução.    |
| `NODE_ENV`                   | `""`           | Apenas `development` habilita o modo dev (autopreenchimento do token). Qualquer outro valor (ou ausência) é modo estrito. |
| `PORT`                       | `8787`         | Porta do servidor HTTP.                                                    |
| `CACHE_TTL_MS`               | `180000`       | TTL (ms) do cache em memória das rotas de leitura. Mais alto = respostas repetidas mais rápidas, porém dados mais defasados. |
| `TELEGRAM_FETCH_CONCURRENCY` | `5`            | Max de chats buscados em paralelo nas listagens. Mais alto = mais rápido com muitos chats, mas aumenta risco de `FLOOD_WAIT`. |
| `UPLOAD_PROGRESS_TTL_MINUTES`| `5`            | Minutos que um job de upload concluído/falho/cancelado fica consultável em `GET /api/v1/{video,audio}/upload/progress/:jobId`. |
| `UPLOAD_CONCURRENCY_LIMIT`   | `1`            | Max de uploads reais ao Telegram em paralelo, **por fila** (vídeo e áudio têm filas independentes). O total combinado pode chegar ao dobro deste valor. |

## Exclusiva de teste (não lida pelo servidor)

| Variável                 | Descrição                                                                 |
| ------------------------ | ------------------------------------------------------------------------- |
| `SMOKE_TEST_CHANNEL_ID`  | Canal que `pnpm test:e2e` usa para exercitar list/upload/edit/delete num canal real (não só Saved Messages). Deve incluir o prefixo `-100`. Leitura apenas em `test/e2e/helpers/video-fixture.ts`. |