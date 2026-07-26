# syntax=docker/dockerfile:1

ARG NODE_VERSION=22-bookworm-slim
ARG PNPM_VERSION=11.17.0

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
WORKDIR /app
RUN corepack enable && corepack use pnpm@${PNPM_VERSION}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS deps
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM deps AS build
COPY tsconfig.json tsconfig.jest.json ./
COPY src ./src
RUN npx pnpm build

# Development image: full devDependencies, runs nodemon+tsx.
# Intended to be used with docker-compose bind-mounting ./src for hot reload.
FROM base AS dev
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json tsconfig.jest.json ./
COPY src ./src
ENV NODE_ENV=development
EXPOSE 8787
CMD ["npx", "pnpm", "dev"]

# Production image: only prod dependencies + compiled dist/, runs as non-root.
FROM base AS prod
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]
