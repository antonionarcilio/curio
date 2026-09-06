# Autenticação e segurança

## Token mestre (`ACCESS_TOKEN`)

Toda rota exige o token em `Authorization: Bearer SEU_TOKEN`:

```bash
curl -H "Authorization: Bearer SEU_TOKEN" http://localhost:8787/api/v1/channels
```

O `ACCESS_TOKEN` é tratado como senha: nunca o publique em lugares públicos nem o
exponha em logs. Todas as rotas são **privadas** (exigem o header) ou
**híbridas** (header **ou** URL assinada, ver abaixo) — consulte
[`ROUTES.md`](ROUTES.md) para saber qual é qual.

## Rotas de streaming/download e URL assinada

As rotas de streaming e download (`video/stream`, `video/dl`, `audio/stream`,
`audio/dl`) precisam ser abríveis direto por URL — VLC, `<video src>`/`<audio src>`
e navegadores não enviam headers customizados numa navegação simples. Em vez de
aceitar o `ACCESS_TOKEN` mestre na query string (vazaria o token completo no
histórico e nos logs), elas aceitam uma **URL assinada e com expiração**:

```
/api/v1/video/stream/:chatId/:messageId?exp=...&sig=...
```

- `exp` é o timestamp de expiração, **1 hora** a partir da emissão.
- `sig` é uma assinatura HMAC calculada sobre o `chatId`/`messageId` específico
  e o `exp`, usando o `ACCESS_TOKEN` como chave.
- A URL só é válida para **aquele** `chatId`/`messageId`. Não serve para outro
  arquivo nem para explorar o servidor.
- Se uma dessas URLs vazar, o dano fica limitado àquele arquivo até a assinatura
  expirar — o token mestre nunca é exposto.

As listagens (`videos/grouped`, `audios/grouped`, `videos/by/:chatId`,
`audios/by/:chatId`, ...) já retornam o campo `url` assinado e pronto para abrir.

## Modo dev

Em `NODE_ENV=development`, se uma requisição não trouxer o header `Authorization`,
o servidor o preenche automaticamente com o `ACCESS_TOKEN` configurado — evita
passar o header em toda chamada local. `npm run dev` já exporta
`NODE_ENV=development` automaticamente (ver `package.json`).

**Qualquer outro valor de `NODE_ENV` (inclusive ausente)** cai no modo estrito: o
header é obrigatório e nada é preenchido automaticamente. O servidor nunca
autentica sozinho a menos que você diga explicitamente que está em dev
(fail-closed em `src/config.ts`).