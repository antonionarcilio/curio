# CLAUDE.md

Guideline for agents working in this repo. Rules, conventions, and footguns —
not a catalog. Route semantics live in `docs/ROUTES.md`; env vars in
`src/config.ts` + `.env.sample`; everything else is discoverable in `src/`.

## What this is

An HTTP server that streams **video and audio** stored in Telegram (private
channels or "Saved Messages") over HTTP with Range support, so any HTTP player
(VLC, browser `<video>`/`<audio>`) can seek into them. It authenticates as a
**user account** via MTProto (TeleProto), not the Bot API, because the Bot API
cannot see private channel history or Saved Messages.

## Commands

```bash
npx pnpm install        # dependencies
npx pnpm login          # one-time interactive MTProto login → prints TELEGRAM_SESSION for .env
npx pnpm dev            # tsx + nodemon (NODE_ENV=development), restarts on src/ changes
npx pnpm start          # node dist/server.js (runs the compiled build)
npx pnpm build          # tsc && tsc-alias  (tsc-alias rewrites @/* in the emitted JS)
npx pnpm lint           # eslint
npx pnpm format         # prettier --write
npx pnpm typecheck      # tsc --noEmit for src/, then again for src/+test/ via tsconfig.jest.json
npx pnpm test           # unit + int (what the pre-commit hook runs)
npx pnpm test:e2e       # manual, opt-in — hits the real Telegram API (see the `testing` skill)
npx pnpm test:coverage  # unit + int with coverage report
```

## Stack

pnpm (always `npx pnpm ...`; `pnpm-lock.yaml`). Node pinned via `.nvmrc`
(`v22.19.0`), no `engines` field. TypeScript throughout — there are no `.js`
files under `src/`. `npx pnpm start` runs `dist/`, so a build must succeed first.

## Testing

Detailed mechanics — layers, mocking, e2e protocol, fixtures — are in the
**`testing` skill. Invoke it before writing or changing any test.** The rules
that matter for every task:

- TDD is required: failing test first, minimal implementation, refactor green.
- Three layers, keyed by filename suffix: `.unit` / `.int` / `.e2e`.
- TeleProto is **always mocked outside `test/e2e/`**.
- e2e is **opt-in / manual** (`npx pnpm test:e2e`), hits the real account in
  `.env`, and never runs in `pnpm test`, the pre-commit hook, or CI.
- Keep coverage **≥90%** (lines/branches/functions/statements), verified with
  `npx pnpm test:coverage`. This is a convention — there is no `coverageThreshold`
  in the jest config and no commit gate. Do not describe it as enforced.

## Configuration

`src/config.ts` (a Zod schema validated at import time) is the authoritative
list of environment variables. Every new var **must** be added there **and**
mirrored in `.env.sample` with a brief comment. `NODE_ENV` must be exactly
`development` to enable dev auth auto-fill; any other value is strict.
`UPLOAD_CONCURRENCY_LIMIT` governs the video and audio upload queues
**independently** — combined real uploads can reach twice its value.

## Where code lives

Every file under `src/` belongs to exactly one layer, determined by what it
imports:

- **`src/routes/**/route.ts`** — one `route.ts` per endpoint, mirroring the path
  after `/api/v1` (`/api/v1/cache/purge` → `src/routes/cache/purge/route.ts`).
  Parse the request (params/query/body), call a service, return the response.
  No business logic, no direct Telegram calls, no shared helpers here.
- **`src/services/`** — business logic, by subdomain (`videos/`, `audios/`).
  May import `config`, `telegram-client`, `utils/`, external packages. Shared
  video/audio behavior lives in generic `create-*` factories.
- **`src/utils/`** — pure, generic, no imports from `src/` except other `utils/`.
- **`src/telegram-client/`** — the *only* place that talks to TeleProto. Routes
  and services go through it, never TeleProto directly.

Rule of thumb for a new file: imports from `src/`? → `services/`. Imports nothing
from `src/`? → `utils/`. Request handler? → `routes/` as a `route.ts`.

## Auth

`requireToken` (`src/server.ts`) enforces `Authorization: Bearer <ACCESS_TOKEN>`
on every route. The only exception: `video`/`audio` `stream` and `dl` routes also
accept a signed, time-limited query (`?exp=...&sig=...`, HMAC-SHA256 over
`chatId:messageId:exp`, 1h TTL) so they work as direct URLs in VLC / `<video src>`
/ download links. They never accept the raw master token in the query. Handlers
that embed a media URL in JSON call `createSignedUrl` (`src/signed-url.ts`) —
they never reflect a token from the request.

**Dev auto-fill, fail-closed:** if `config.isDev` (`NODE_ENV === "development"`,
exact match) and the request has no `Authorization` header, `requireToken`
injects `Bearer <ACCESS_TOKEN>`. Any other `NODE_ENV`, including unset, enforces
the header strictly.

## Request input placement

Place each input by its HTTP role — do not move inputs around to make routes
look uniform:

- **Path** — the stable target: `chatId`, `messageId`, `jobId`. Not duplicated
  in the body.
- **Query** — `GET` representation options: filtering, sorting, pagination,
  `thumbnail`. Never mutates. No body on a `GET` route.
- **Body** — data that creates or changes state (JSON by default;
  `multipart/form-data` for file uploads).
- **Headers** — transport/auth only (`Authorization`, `Range`).

The only query-string exception is `exp`/`sig` on the direct stream/download
URLs. If a read filter is sensitive enough to keep out of logs and shared URLs,
add a **new documented `POST` search endpoint** with a JSON body — do not
overload the existing `GET` contract, and do not add one speculatively.

For every route change, update its Zod parser, int tests, `docs/ROUTES.md`, and
the matching Insomnia request **in the same change**. Tests must assert the
intended location of each input, not just the response.

## Pagination

Any new route that reads a set of items from Telegram **must** accept `limit`,
`page`, and `per_page`, reusing `src/utils/pagination.ts`
(`paginationQuerySchema`, `isPaginationRequested`, `resolvePagination`,
`paginate` / `buildPageEnvelope`) and the `limit`-as-`per_page` fallback. If a
route genuinely does not fit (always one item, not a listing), **stop and ask**
for explicit confirmation, then document the exception where the route is
documented. Approved exceptions already exist: `GET /api/v1/me`,
`GET /api/v1/health`.

## Caching

Every read in `src/telegram-client/` is wrapped with `withCache` from
`@/utils/ttl-cache`: write the body as `fooUncached`, then export
`withCache(config.cacheTtlMs, keyFn, fooUncached)` — matching the existing reads.
The cache is in-memory, keyed per function, dedupes concurrent identical calls,
and is cleared by `clearAllCaches()` / `POST /api/v1/cache/purge`. A new cached
read becomes purgeable automatically. The byte transfer itself is never cached —
only the metadata lookup. `listAllVideos` / `listAllAudios` fan out with
`p-limit`, pinned to `3.1.0` (v4+ is ESM-only and breaks this CommonJS project).

## Streaming / auth footguns

- Chunking uses a fixed `CHUNK_SIZE` of 512 KB (`src/utils/http-response.ts`).
- MediaScheduler offsets must be a `big-integer` instance (the `big-integer`
  package), never native `BigInt`. The helper aligns Telegram fetches to
  `CHUNK_SIZE` and slices defensively so the HTTP body never exceeds
  `Content-Length`.
- Client disconnect is tracked (`req.on("close")`) so an aborted download stops
  pulling from Telegram.
- `Content-Disposition` filenames must be ASCII-safe or the header write throws
  and the catch block turns it into a misleading `404`. Use
  `buildContentDisposition` (ASCII fallback + percent-encoded `filename*`).
- `chatId` is passed straight to TeleProto; `"me"` is its shortcut for Saved
  Messages.

## Conventions

- **JSON response fields**: `snake_case`, lowercase (`chat_id`, `message_id`,
  `file_name`, `mime_type`). Internal camelCase is fine when not serialized.
- **Telegram peers in JSON**: never bare `id`/`title`. Use `channel_id` /
  `channel_title` on a route that can *only* return a `Channel`
  (`/api/v1/channels`, `/api/v1/channel/:channel_id`); use `chat_id` /
  `chat_title` on a route that can return any dialog type (`/api/v1/videos/grouped`,
  `/api/v1/videos/by/:chatId`, and the audio equivalents).
- **Text filtering**: use `normalizeForSearch` / `includesSearchTerm`
  (`src/utils/text-search.ts`) — the one substring-match implementation. Route
  filters build on `src/services/media-filters.ts`.
- **Native Telegram filter**: `Api.InputMessagesFilterVideo` /
  `Api.InputMessagesFilterMusic` (server-side; returns a real `.total`).
- **Doc files**: `SNAKE_CASE` + uppercase (`docs/ROUTES.md`, `docs/DEPLOYMENT.md`).
  Exempt: `README.md`, `CLAUDE.md`, `AGENTS.md`.
- **Directories**: `kebab-case`, lowercase.
- **Imports crossing a directory**: absolute alias `@/*` (src) / `@test/*`
  (test), never `../..`. Same-directory imports stay relative. The aliases are
  declared in `tsconfig.json`, `tsconfig.jest.json`, `jest.config.js`, and
  `jest.e2e.config.js` — keep the four in sync.
- Use `import type` for types, plain `import` for values, in separate statements.

## Documenting routes

Every route gets an entry in `docs/ROUTES.md` (purpose, query params, Privada or
Híbrida) and a mirrored request in `docs/insomnia/Insomnia.yaml` — same session,
`docs/ROUTES.md` is authoritative. `README.md` stays high-level.

## Coding patterns

- Functions: 4-20 lines. Files: under 500 lines. One responsibility per module.
- Names: specific and unique. Avoid `data`, `handler`, `Manager`. Prefer names
  with <5 grep hits.
- Types: explicit. No `any`, no untyped functions. Validate with Zod.
- No duplication — extract shared logic. Early returns over nesting; max 2 levels
  of indentation.
- Exception messages include the offending value and the expected shape.
- Reference an issue number / commit SHA when a line exists because of a specific
  bug or upstream constraint.
- Prefer types over interfaces (except when extending external types). Prefer
  functions over classes (classes only for errors/adapters). Prefer pure
  functions; when mutation is unavoidable, return the mutated object.
- Organize files top-down: exports before helpers.
- Comments say WHY, not WHAT. Prefer self-describing names over a name plus a
  comment explaining it.
- Prefix booleans with `is` / `has` / `can` / `should`.
- No abbreviations in names.

## Git hooks

`.husky/pre-commit` runs, in order: `npx pnpm lint-staged`, `npx pnpm typecheck`,
`npx pnpm test` (unit + int — never `test:e2e`). All three must pass.

## Commit guidelines

Never perform Git history operations unless explicitly instructed — no commits,
amends, squashes, rebases, pushes, or tags. After finishing an implementation,
leave everything uncommitted, present the changed files, and let the user write
the commit.

## Logging

Structured JSON for debugging/observability. Plain text only for user-facing CLI
output.
