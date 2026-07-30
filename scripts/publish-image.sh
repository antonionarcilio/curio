#!/usr/bin/env bash
# Builda a imagem de produção (Dockerfile, target: prod) e publica no GHCR
# manualmente — alternativa ao workflow automático em
# .github/workflows/docker-publish.yml, que só roda em push na branch master.
#
# Uso:
#   ./scripts/publish-image.sh --username USUARIO --token TOKEN [tag]
#
# [tag] é opcional; por padrão usa o short SHA do commit atual (mesma
# convenção do workflow do GitHub Actions). Em toda execução, a imagem
# também recebe a tag "latest".
#
# --username/-u e --token/-t autenticam no GHCR antes do build. TOKEN precisa
# ser um Personal Access Token (classic) com escopo `write:packages`. Se
# nenhum dos dois for informado, o script assume que você já rodou
# `docker login ghcr.io` manualmente antes.
#
# Aviso: passar o token como parâmetro de linha de comando o expõe no
# histórico do shell e na listagem de processos (`ps`) enquanto o script
# roda. Se isso for uma preocupação no seu ambiente, prefira rodar
# `docker login ghcr.io` manualmente e chamar o script sem --token.

set -euo pipefail

REGISTRY="ghcr.io"
OWNER="antonionarcilio"
IMAGE="tg-uploader-api"
FULL_IMAGE="${REGISTRY}/${OWNER}/${IMAGE}"

usage() {
  echo "Uso: $0 [--username USUARIO] [--token TOKEN] [tag]" >&2
  exit 1
}

USERNAME=""
TOKEN=""
TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --username|-u)
      USERNAME="${2:-}"
      [[ -z "$USERNAME" ]] && usage
      shift 2
      ;;
    --token|-t)
      TOKEN="${2:-}"
      [[ -z "$TOKEN" ]] && usage
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      [[ -n "$TAG" ]] && usage
      TAG="$1"
      shift
      ;;
  esac
done

TAG="${TAG:-$(git rev-parse --short HEAD)}"

if [[ -n "$USERNAME" || -n "$TOKEN" ]]; then
  if [[ -z "$USERNAME" || -z "$TOKEN" ]]; then
    echo "Erro: --username e --token precisam ser informados juntos." >&2
    exit 1
  fi
  echo "==> Autenticando em ${REGISTRY} como ${USERNAME}..."
  echo "${TOKEN}" | docker login "${REGISTRY}" -u "${USERNAME}" --password-stdin
fi

echo "==> Buildando ${FULL_IMAGE}:${TAG} (target: prod)..."
docker build --target prod -t "${FULL_IMAGE}:${TAG}" -t "${FULL_IMAGE}:latest" .

echo "==> Publicando ${FULL_IMAGE}:${TAG}..."
docker push "${FULL_IMAGE}:${TAG}"

echo "==> Publicando ${FULL_IMAGE}:latest..."
docker push "${FULL_IMAGE}:latest"

echo "==> Concluído: ${FULL_IMAGE}:${TAG} e ${FULL_IMAGE}:latest publicados."
