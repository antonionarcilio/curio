# telegram-cdn

Servidor HTTP que transmite (stream) vídeos guardados no Telegram — em canais
privados de que você faz parte ou em "Saved Messages" — expondo uma URL que
pode ser aberta em qualquer player compatível com HTTP (VLC, navegador, etc.),
com suporte a seek via Range requests.

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
   [nodemon](https://github.com/remy/nodemon) e reinicia o servidor sozinho
   sempre que um arquivo em `src/` for alterado.

## Autenticação

Toda rota exige o token em `Authorization: Bearer SEU_TOKEN`.

```bash
curl -H "Authorization: Bearer SEU_TOKEN" http://localhost:8787/api/v1/channels
```

As rotas de streaming e download (`/api/v1/video/stream/:chatId/:messageId` e
`/api/v1/video/dl/:chatId/:messageId`) precisam ser abríveis direto por URL
(VLC, `<video src>`, navegador), que não enviam headers customizados numa
navegação simples. Em vez de aceitar o `ACCESS_TOKEN` mestre na query string,
elas aceitam uma **URL assinada e com expiração** (`?exp=...&sig=...`), válida
só para aquele `chatId`/`messageId` específico por 1 hora. Assim, se uma dessas
URLs vazar, o dano fica limitado àquele vídeo até a assinatura expirar — o
token mestre nunca é exposto.

**Modo dev (`NODE_ENV=development`)**: se a requisição não trouxer o header
`Authorization`, o servidor o preenche automaticamente com o `ACCESS_TOKEN`
configurado — evita ter que passar o header manualmente em toda chamada local
(`npm run dev` não define isso sozinho; é preciso exportar `NODE_ENV=development`
explicitamente). **Qualquer outro valor de `NODE_ENV` (inclusive ausente)** cai
no modo estrito: o header é obrigatório e nada é preenchido automaticamente —
por segurança, o servidor nunca autentica sozinho a menos que você diga
explicitamente que está em dev.

## Rotas

O servidor expõe rotas versionadas em `/api/v1`: `channels`,
`videos/grouped`, `videos/by/:chatId`, `video/stream/:chatId/:messageId`,
`video/dl/:chatId/:messageId`, `video/upload/:chatId`,
`video/update/:chatId/:messageId`, `video/delete/:chatId/:messageId` e
`cache/purge`. Referência completa — propósito, query params aceitos e se cada
rota é privada ou híbrida — em
**[`docs/ROUTES.md`](docs/ROUTES.md)**.

A forma mais prática de usar o servidor: chame `/api/v1/videos/grouped`,
escolha o vídeo na lista, e abra o campo `url` retornado direto no
VLC/navegador — já vem assinado e expira em 1h.

## Segurança

O `ACCESS_TOKEN` é obrigatório em toda requisição, via header
`Authorization: Bearer ...`. As rotas `video/stream` e `video/dl` nunca aceitam
o token mestre na query string — só URLs assinadas com expiração de 1h,
escopadas a um único vídeo (ver "Autenticação"). Trate o `ACCESS_TOKEN` como
uma senha: não o publique em lugares públicos.
