# Deploy (Docker)

## Docker Compose

Por padrão, `docker compose up` sobe o ambiente de **produção** (`target: prod`
do `Dockerfile`, sem hot reload):

```bash
docker compose up --build
```

**Desenvolvimento** (hot reload via `nodemon`, montando `src/` do host) exige
combinar o arquivo extra `docker-compose.dev.yml`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Build local

Produção pode buildar localmente a partir do `Dockerfile` (`target: prod`), em
vez de usar a imagem do GHCR:

```bash
docker build --target prod -t api-tg-cdn:prod .
docker run -d --name api-tg-cdn --env-file .env -p 8787:8787 api-tg-cdn:prod
```

## Rodando a imagem publicada no GHCR

```bash
docker pull ghcr.io/antonionarcilio/api-tg-cdn:latest
docker run -d --name api-tg-cdn --env-file .env -p 8787:8787 ghcr.io/antonionarcilio/api-tg-cdn:latest
```

- **`--env-file .env`**: a imagem não embute nenhuma credencial — precisa do seu
  `.env` local com `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION` e
  `ACCESS_TOKEN` já preenchidos (ver "Configuração inicial" no
  [`README.md`](../README.md) e [`CONFIGURATION.md`](CONFIGURATION.md)).
- **`-p 8787:8787`**: mapeia a porta do host para a do container. Se o seu `.env`
  define `PORT` com outro valor, ajuste os dois lados (ex.: `-p 9000:9000` com
  `PORT=9000` no `.env`).
- Essa imagem é sempre `target: prod` — roda `node dist/server.js` direto, sem
  hot reload nem devDependencies.
- Pull: o repositório `antonionarcilio/api-tg-cdn` é público. Se `docker pull`
  mesmo assim retornar `unauthorized`/`denied` (o pacote GHCR pode ter
  visibilidade própria independente do repo), autentique antes com
  `docker login ghcr.io -u antonionarcilio` (um PAT com escopo `read:packages`
  já é suficiente para pull).
- Para rodar em background, adicione `-d`; para nomear o container (facilita
  `docker logs`/`docker stop` depois), adicione `--name api-tg-cdn`:

  ```bash
  docker run -d --name api-tg-cdn --env-file .env -p 8787:8787 \
    ghcr.io/antonionarcilio/api-tg-cdn:latest
  ```

## Publicação da imagem

A publicação no GHCR tem fluxo próprio — ver [`PUBLISHING.md`](PUBLISHING.md).
