# Publicação da imagem (GHCR)

A imagem de produção é publicada em `ghcr.io/antonionarcilio/api-tg-cdn`. O
repositório `antonionarcilio/api-tg-cdn` é público; a visibilidade do pacote
GHCR pode, no entanto, ser configurada independentemente — confira em
https://github.com/antonionarcilio/api-tg-cdn/pkgs/container/api-tg-cdn.

## Automática (GitHub Actions)

Todo push na branch `master` dispara `.github/workflows/docker-publish.yml`, que
builda a imagem (`target: prod`) e publica duas tags: `latest` e
`sha-<short-sha>` do commit. O workflow usa apenas o `GITHUB_TOKEN` do próprio
Actions (escopo `packages: write`) — não precisa de nenhum secret adicional
configurado no repositório.

## Manual (script `scripts/publish-image.sh`)

Builda a imagem localmente e publica no GHCR sem precisar esperar um push em
`master`:

```bash
# usa o short SHA do commit atual como tag (+ "latest")
./scripts/publish-image.sh

# ou informe uma tag específica
./scripts/publish-image.sh v1.2.3
```

**Pré-requisito**: estar autenticado no GHCR. Passe as credenciais como
parâmetros (`--username`/`-u` e `--token`/`-t`, um Personal Access Token com
escopo `write:packages`) e o script faz o login sozinho antes do build:

```bash
./scripts/publish-image.sh --username antonionarcilio --token ghp_xxx
./scripts/publish-image.sh --username antonionarcilio --token ghp_xxx v1.2.3
```

Se preferir não passar o token pelo script (ele fica visível no histórico do
shell e em `ps` durante a execução), rode `docker login ghcr.io` manualmente
antes e chame o script sem `--username`/`--token`.