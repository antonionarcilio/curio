<div align="center">

# API - Telegram CDN

**Seu Telegram como CDN de mídia** — stream de vídeo e áudio de canais privados
e Saved Messages, com seek via Range requests.

[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11.17-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.19-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![Jest](https://img.shields.io/badge/Jest-30-C21325?style=flat-square&logo=jest&logoColor=white)](https://jestjs.io/)
[![Telegram MTProto](https://img.shields.io/badge/Telegram-MTProto-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://core.telegram.org/mtproto)
[![Docker GHCR](https://img.shields.io/badge/Docker-GHCR-2496ed?style=flat-square&logo=docker&logoColor=white)](https://ghcr.io/antonionarcilio/api-tg-cdn)
[![HTTP Range](https://img.shields.io/badge/HTTP-Range_Seek-FF6C37?style=flat-square)]()
[![Repo size](https://img.shields.io/github/repo-size/antonionarcilio/api-tg-cdn?style=flat-square)]()
[![License MIT](https://img.shields.io/github/license/antonionarcilio/api-tg-cdn?style=flat-square)]()

</div>

Servidor HTTP que transmite (stream) **mídia — vídeo e áudio** — guardada no
Telegram, em canais privados de que você faz parte ou em "Saved Messages",
expondo uma URL que pode ser aberta em qualquer player compatível com HTTP
(VLC, navegador, etc.), com suporte a seek via Range requests.

Usa [TeleProto](https://docs.teleproto.dev/) autenticado como **conta de usuário**
(MTProto), já que a Bot API não enxerga o histórico de canais privados nem de
Saved Messages, e limita downloads a 20MB.

## Configuração inicial

1. Crie um app em https://my.telegram.org → "API Development Tools" e anote
   `api_id` e `api_hash`.
2. Copie `.env.sample` para `.env` e preencha `TELEGRAM_API_ID` e
   `TELEGRAM_API_HASH`. Defina também um `ACCESS_TOKEN` (senha simples que vai
   proteger a URL do servidor).
3. Instale as dependências:

   ```bash
   npm install
   ```

4. Faça o login único (telefone + código enviado pelo Telegram + senha 2FA se
   você tiver):

   ```bash
   npm run login
   ```

   Ao final, o comando imprime uma string — cole-a em `TELEGRAM_SESSION` no
   `.env`. Isso evita ter que logar de novo nas próximas execuções.

5. Suba o servidor:

   ```bash
   npm start
   ```

   Durante o desenvolvimento, use `npm run dev` em vez disso — ele roda com
   [nodemon](https://github.com/remy/nodemon), reinicia o servidor sozinho
   sempre que um arquivo em `src/` for alterado.

## Uso rápido

A forma mais prática: chame `/api/v1/videos/grouped` (ou `/api/v1/audios/grouped`),
escolha o item na lista e abra o campo `url` retornado direto no VLC/navegador —
a URL já vem assinada e expira em 1h.

## Autenticação

Toda rota exige o token em `Authorization: Bearer SEU_TOKEN`. As rotas de
streaming/download não podem levar o token mestre na query string — elas
aceitam uma **URL assinada e com expiração** (`?exp=...&sig=...`), escopada ao
`chatId`/`messageId` e válida por 1h. Detalhes completos (mecânica da assinatura,
modo dev) em **[`docs/AUTH.md`](docs/AUTH.md)**.

## Docker

Rápido — produção:

```bash
docker compose up --build
```

Desenvolvimento (hot reload):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Referência completa (build local, imagem do GHCR, mapeamento de portas) em
**[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**; publicação de imagem em
**[`docs/PUBLISHING.md`](docs/PUBLISHING.md)**.

## Rotas

O servidor expõe rotas versionadas em `/api/v1`: `health`, `channels`, `me`,
`videos/grouped`, `videos/by/:chatId` e `audios/grouped`, `audios/by/:chatId`
(+ `stream`/`dl`/`upload`/`update`/`delete` para vídeo e áudio), além de
`cache/purge`. Referência completa — propósito, query params aceitos e se cada
rota é privada ou híbrida — em **[`docs/ROUTES.md`](docs/ROUTES.md)**.

## Referência de configuração

Todas as variáveis de ambiente (obrigatórias, opcionais e exclusivas de teste)
com defaults em **[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)**.

## Segurança

Trate o `ACCESS_TOKEN` como uma senha: não o publique em lugares públicos. O
token mestre nunca é aceito na query string e nunca é exposto ao client de
streaming — a assinatura limita o dano de um vazamento a um único arquivo até
expirar. Veja **[`docs/AUTH.md`](docs/AUTH.md)**.
