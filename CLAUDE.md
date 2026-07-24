# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An HTTP server that streams videos stored in Telegram (private channels or "Saved Messages") over HTTP with Range-request support, so any HTTP-capable player (VLC, browser `<video>`) can seek into them. It authenticates to Telegram as a **user account** via MTProto (GramJS), not the Bot API, because the Bot API cannot see private channel history or Saved Messages, and it caps downloads at 20MB.

## Package manager

pnpm (see `pnpm-lock.yaml` / `pnpm-workspace.yaml`). Node version is pinned via `.nvmrc` (`v22.19.0`). There is no `engines` field in `package.json` enforcing this.

## Commands

### Environment setup

```bash
npx pnpm install        # install dependencies
npx pnpm login          # one-time interactive MTProto login (phone + code + optional 2FA password)
```

### Development

```bash
npx pnpm start          # run the server (src/server.js)
npx pnpm dev            # run with nodemon, auto-restarting on changes under src/
```

### Build

```bash
npx pnpm build          # tsc: compiles src/**/*.ts to dist/
```

There is no separate build-step-only command beyond this: `npx pnpm start` runs the compiled output from `npx pnpm build`.

### Code quality

```bash
npx pnpm lint           # run ESLint
npx pnpm format          # format the codebase with Prettier
npx pnpm format:check   # check formatting without writing
npx pnpm typecheck      # tsc --noEmit
```

### Testing

```bash
npx pnpm test           # run the Jest test suite once
npx pnpm test:watch     # Jest in watch mode
```

### Login flow

`npx pnpm login` runs `src/login.js`, which prompts interactively (phone number, 2FA password, Telegram code) and prints a `TELEGRAM_SESSION` string at the end. That string must be pasted into `.env` so subsequent runs don't require re-authentication.

## Testing

TDD is the standard practice for this project: for any new feature or bugfix, write a failing test first (a unit test for pure/near-pure logic, or a supertest HTTP test for route/middleware behavior with `telegram-client.ts` mocked), watch it fail, implement the minimal change to make it pass, then refactor with the test green. There is no CI enforcement of this yet — it's a project convention backed by the pre-commit hook (see "Git hooks" below), not an automated gate beyond the local commit.

Tests live under `test/`, mirroring `src/`'s structure (`test/signed-url.test.ts` ↔ `src/signed-url.ts`, `test/routes/stream-video.route.test.ts` ↔ `src/routes/stream-video.route.ts`, `test/cache/ttl-cache.test.ts` ↔ `src/cache/ttl-cache.ts`, etc.). `test/setup-env.ts` runs automatically before every test file (via `jest.config.js`'s `setupFiles`) and sets fake `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`ACCESS_TOKEN`/etc. so `src/config.ts` never throws and no real `.env` is required or touched during tests. Tests run under `ts-jest` against `tsconfig.jest.json` — a copy of `tsconfig.json` with `rootDir`/`include` widened to also cover `test/`, kept separate from the main `tsconfig.json` so `npx pnpm build`/`npx pnpm typecheck` (which target `src/` only) are unaffected.

**GramJS is always mocked, never real** — no test ever calls real Telegram/MTProto:
- Tests of `src/telegram-client.ts` itself mock the low-level `telegram` package (`jest.mock('telegram')`, `jest.mock('telegram/sessions')`), stubbing `TelegramClient`'s methods (`connect`, `getMessages`, `getDialogs`, `getEntity`, `iterDownload`) and `Api.InputMessagesFilterVideo` directly.
- Tests of `src/routes/*.ts` and `src/server.ts` mock the higher-level `src/telegram-client.ts` module instead (`jest.mock('../../src/telegram-client')`), stubbing its exported functions (`getVideoMessage`, `listVideos`, `listAllVideos`, `listChannels`, `getChannelVideos`) and `client.iterDownload` (returned as a fake async iterable yielding `Buffer` chunks) — these tests never reach into GramJS internals.
- `client.iterDownload`'s `offset`/`limit` arguments must always be `big-integer` instances, never native `BigInt` (see "Key implementation details" below); `test/routes/stream-video.route.test.ts` asserts this explicitly to guard against silent regressions.

**Caching between tests**: `src/cache/ttl-cache.ts` keeps its cache registry at module scope, so `test/telegram-client.test.ts` calls `clearAllCaches()` in `beforeEach` to stop one test's mocked `getMessages`/`getDialogs`/etc. call count from leaking into the next (Jest gives each *test file* a fresh module registry automatically, so this only matters within a single file, not across files).

`src/server.ts` exports `buildApp()` (a synchronous Express app factory with no I/O) alongside `startServer()` (the real `ensureConnected()` + `app.listen()` path used by `npx pnpm start`) precisely so tests can `request(buildApp())` with `supertest` without connecting to Telegram or binding a real port. `startServer()`/`main` only runs when `server.ts` is executed directly (`require.main === module` guard), never merely on import — this is also why `test/server.test.ts` can `jest.resetModules()` + re-`require('../src/server')` inside an isolated `describe` block to exercise the dev auto-fill behavior (`config.isDev` is computed once per module load, from `process.env.NODE_ENV` at that moment) without affecting other tests in the file.

`src/login.ts` (interactive CLI login script) is intentionally left without tests — it's a one-off manual script (prompts for phone/2FA/code, calls `process.exit`), not meaningfully unit-testable without a real Telegram account.

## Configuration

Copy `.env.example` to `.env` and set:

- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` — from https://my.telegram.org → "API Development Tools"
- `TELEGRAM_SESSION` — produced by `npx pnpm login`
- `PORT` — HTTP port (default 8787)
- `ACCESS_TOKEN` — shared secret required via `Authorization: Bearer ...` on every request; also used as the HMAC key for signed streaming URLs (see below). Treat it as a password.
- `NODE_ENV` — must be exactly `development` to enable the dev auto-fill behavior described below; any other value (including unset) is treated as strict/production
- `CACHE_TTL_MS` — how long (ms) read results from `telegram-client.ts` stay cached in memory (default `180000`, 3 min). See "Caching and fetch concurrency" below.
- `TELEGRAM_FETCH_CONCURRENCY` — max chats fetched in parallel by `listAllVideos` (default `5`). Higher values speed up `/videos` but raise the risk of hitting Telegram's `FLOOD_WAIT`.

`src/config.js` centralizes env parsing and throws immediately if `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` are missing.

## Architecture

- `src/config.js` — loads and validates env vars via dotenv.
- `src/telegram-client.js` — owns the single shared `TelegramClient` instance (GramJS) and all Telegram-facing logic: connecting once (`ensureConnected`, lazy singleton), resolving video documents out of messages (`extractVideoDocument` — checks mimeType or `DocumentAttributeVideo`), and read operations (`listVideos`, `listAllVideos` sweeping all dialogs, `listChannels`, `getChannelVideos`, `getVideoMessage`). All routes go through this module rather than touching the GramJS client directly. Every read operation is wrapped in the TTL cache described below.
- `src/cache/ttl-cache.js` — generic in-memory TTL cache (`createTtlCache`) plus `withCache`, a one-line wrapper used to apply that cache to any read function. See "Caching and fetch concurrency" below.
- `src/routes/` — one Express router file per endpoint (`list-videos.route.js`, `list-channels.route.js`, `channel-videos.route.js`, `list-chat-videos.route.js`, `stream-video.route.js`, `purge-cache.route.js`), plus `http-utils.js` (shared `parseRange`, `buildContentDisposition`, `CHUNK_SIZE`, `SAFE_MIME_TYPE`) and `index.js`, which mounts every route file onto one router and also serves `GET /routes` — introspecting the fully composed, recursively-walked router tree (mounted sub-routers included) so it never drifts out of sync as routes are added or removed. `stream-video.route.js` handles Range parsing and streams file bytes from Telegram on demand via `client.iterDownload` (offset/limit computed from the Range header), writing chunks to the response with backpressure handling (`res.write` / `drain`). Nothing is downloaded to disk. Filenames are sanitized and `Content-Type` is restricted to a safe video-mime regex before being reflected into headers.
- `src/server.js` — wires it together: calls `ensureConnected()` before listening, applies the token-auth middleware (`requireToken`, using `crypto.timingSafeEqual`) globally to all routes, then mounts the router from `src/routes/index.js`.
- `src/signedUrl.js` — `createSignedUrl`/`verifySignedUrl`: HMAC-SHA256 (keyed with `config.accessToken`) over `chatId:messageId:exp`, 1h TTL. Used instead of embedding the master token in generated streaming URLs.
- `src/login.js` — standalone script (not part of the server) for the one-time interactive login described above.

### Auth: header vs signed query params

`requireToken` in `src/server.js` reads the token from `Authorization: Bearer <token>` by default — this covers every route. The one exception is the streaming route (`/video/:chatId/:messageId`, matched via the `STREAMING_PATH` regex), which also accepts a signed, time-limited query string (`?exp=...&sig=...`, verified with `verifySignedUrl`) — that's the only route ever opened directly by a URL (VLC, browser `<video src>`), and those clients can't attach custom headers to a plain navigation/URL open. It deliberately does **not** accept the raw master token in the query string: a leaked signed URL only exposes one video for up to an hour, whereas a leaked master token would expose everything indefinitely. Discovery routes (`/routes`, `/videos`, `/channels`, `/channels/:channelId/videos`, `/list/:chatId`) require the header only; when their handlers embed a ready-to-use `/video/...` URL in a JSON response, they call `createSignedUrl(base, chatId, messageId)` rather than reflecting any token from the request.

**Dev auto-fill, fail-closed by design:** if `config.isDev` (`NODE_ENV === "development"`, exact match — not just "truthy" or "not production") and the incoming request has no `Authorization` header, `requireToken` injects `Bearer <ACCESS_TOKEN>` automatically before checking it, so local testing doesn't require passing the header on every call. Any other `NODE_ENV` value, including unset, skips this and enforces the header strictly. This was a deliberate choice after considering the alternative (`isDev` defaulting to true unless `NODE_ENV=production`): defaulting to open is a common footgun if a real deployment forgets to set `NODE_ENV` — this codebase defaults to strict instead.

### Request flow

1. Every request must include valid credentials (checked via constant-time comparison in `server.js`) — `Authorization: Bearer <ACCESS_TOKEN>` everywhere, or a signed `?exp=...&sig=...` pair on the streaming route only; requests without either get `401`.
2. `/videos`, `/channels`, `/channels/:channelId/videos`, `/list/:chatId` are discovery endpoints that return JSON (video metadata, and for the first two, ready-to-use `/video/...` URLs with a signed, expiring query string already attached).
   `/routes` is a self-describing endpoint: it recursively walks the router tree mounted in `src/routes/index.js` (each endpoint lives in its own sub-router file) and returns every registered `{ method, path }` pair, so it never drifts out of sync as routes are added or removed.
3. `/video/:chatId/:messageId` is the actual streaming endpoint: it fetches the message, extracts the video document, honors `Range` headers (206 partial content) or streams the whole file (200), pulling bytes from Telegram lazily via `iterDownload` rather than buffering the whole file in memory.

### Caching and fetch concurrency

Every read function exported by `src/telegram-client.js` (`listChannels`, `listVideos`, `getChannelVideos`, `listAllVideos`, `getVideoMessage`) is wrapped with `withCache` from `src/cache/ttl-cache.js`: the function's actual body lives in a `*Uncached` variant, and the exported name is `withCache(config.cacheTtlMs, keyFn, fooUncached)`. The cache is in-memory (per-process, lost on restart), keyed per function (e.g. `` `${chatId}:${limit}:${offset}` `` for `listVideos`), and dedupes concurrent identical requests — if two callers ask for the same key before the first resolves, the second reuses that same in-flight promise instead of triggering a second Telegram call. This is why repeated requests to `/videos`, `/channels`, `/channels/:channelId/videos`, and `/list/:chatId` come back near-instant within the TTL window (`CACHE_TTL_MS`), at the cost of listings being up to that long out of date after a new video is sent on Telegram.

`getVideoMessage` (used by the streaming route to resolve `chatId:messageId` → document/size/mimeType/fileName) is cached the same way, keyed by `` `${chatId}:${messageId}` `` — a video player issuing many `Range` requests while seeking the same video hits this cache instead of re-resolving the message on every chunk. The actual byte transfer (`client.iterDownload` in `stream-video.route.js`) is **never** cached — only the metadata lookup is.

`listAllVideos` additionally fetches chats in parallel (bounded by `TELEGRAM_FETCH_CONCURRENCY`, via `p-limit`) instead of the previous one-chat-at-a-time loop. `p-limit` is pinned to `3.1.0` — versions 4+ are ESM-only and break this CommonJS project.

**Adding a new read function that should be cached**: don't hand-roll `getOrSet` calls — write the function body as `*Uncached`, then export `withCache(config.cacheTtlMs, keyFn, fooUncached)`, matching the existing five. This is what makes the caching "global": any new route that reuses an existing `telegram-client.js` function inherits caching automatically; a genuinely new fetch only needs this one extra line.

**Manual purge**: `POST /cache/purge` (`src/routes/purge-cache.route.js`) calls `clearAllCaches()` from `src/cache/ttl-cache.js`, which clears every cache's `store`/`pending` maps. `createTtlCache` self-registers each instance it creates into a module-level registry specifically so `clearAllCaches()` can reach all of them without `telegram-client.js` having to expose or track its five cache instances individually — a new cached function automatically becomes purge-able the moment it's wrapped in `createTtlCache`/`withCache`, no extra wiring needed. Useful for forcing fresh data after uploading a new video without waiting out `CACHE_TTL_MS` or restarting the process.

### Native video filtering and pagination

`listVideos` (used by `/list/:chatId` and `/channels/:channelId/videos`) and `fetchDialogVideos`/`listAllVideos`'s per-chat fetch (used by `/videos`) call `tg.getMessages(chatId, { filter: new Api.InputMessagesFilterVideo(), limit, addOffset })` instead of fetching raw messages and locally guessing which ones are videos. `Api.InputMessagesFilterVideo` is a Telegram server-side filter — it excludes video notes and GIFs (those have their own filters, `InputMessagesFilterRoundVideo`/`InputMessagesFilterGif`) and returns a `TotalList` whose `.total` is the real count of matching videos in that chat, not an estimate. `extractVideoDocument` no longer decides "is this a video?" (the server already filtered) — it only extracts metadata (`size`, `mimeType`, `fileName`) from the document.

`/channels/:channelId/videos` and `/list/:chatId` (single-chat routes) use this for **true native pagination**: `addOffset = (page - 1) * per_page`, `limit = per_page` — the Telegram server returns exactly that page, so paginating doesn't fetch or discard anything extra, and it also fixed a latent bug where videos beyond the old hardcoded 100/200-raw-message scan window were invisible regardless of `limit`.

`/channels` and `/channels/:channelId/videos` use `channel_id`/`channel_title` in their JSON responses, not `chat_id`/`chat_title` — see the naming-convention note below.

`/videos` (aggregated across every dialog) **cannot** do this — there's no single Telegram call that paginates "all videos across all chats" with one cursor. It still fetches up to `limit` videos **per chat** this way (parallel, cached, same as before) — `limit` here is *not* a total cap on the response, it's the `limit` sent to each per-chat native call, so `?limit=1` with 26 chats that have videos returns 26 items (one per chat), not one. When `page`/`per_page` are supplied the cut is done in memory over the already-aggregated-and-filtered array (`paginate()` in `src/routes/pagination.ts`) — this shrinks the response, not the number of Telegram calls.

`/channels` (the plain dialog list) also takes `limit` (default `100`), passed straight to `tg.getDialogs({ limit })` (`listChannelsUncached` in `src/telegram-client.ts`). Unlike the video filter, Telegram's dialog list has no server-side "channels only" filter, so `limit` caps **dialogs scanned in total** (channels + groups + DMs), not channels returned — `?limit=5` can return fewer than 5 channels if some of the 5 most recent dialogs aren't channels. Pagination on `/channels` is the same in-memory `paginate()` as `/videos`, applied after that scan-and-filter step.

**Response shape, `limit` vs `page`/`per_page`**: all four listing routes accept `limit` (default `100` — how much is fetched/considered, semantics vary by route as described above) and `page`/`per_page` (`per_page` capped at `100` — how the response is sliced). Omitting both `page` and `per_page` returns a flat array/object exactly like before this feature existed (respecting `limit`) — pagination mode, with the `{ data, page, per_page, total, total_pages }` envelope, only activates when at least one of `page`/`per_page` is present (`src/routes/pagination.ts`: `isPaginationRequested`/`resolvePagination`/`buildPageEnvelope`). `limit` isn't just for flat mode: `resolvePagination(query, defaultPerPage)` takes the route's `limit` as `defaultPerPage`, so passing only `page` (no `per_page`) still honors `limit` as the page size instead of silently falling back to a hardcoded `20` — `per_page`, when explicitly given, always wins over `limit`. Signed URLs (`createSignedUrl`) are only generated for the items actually in the response, never for a full unpaginated list when a page was requested.

### Text filtering (fuzzy, accent/case-insensitive)

`src/utils/text-search.ts` exports `normalizeForSearch` (NFD-normalize, strip diacritics, lowercase, trim) and `includesSearchTerm` (normalizes both sides, then `includes`) — this is the one substring-match implementation every route-level filter is built on; don't reimplement normalization elsewhere.

`/videos` filters on `chat_id` (exact match, digits-only comparison via `extractDigits` in `src/routes/video-filters.ts` — Telegram channel/supergroup IDs are negative, so the `-` is stripped before comparing), `chat_title`, and `file_name` (both fuzzy, via `filterVideos`/`matchesVideoFilters`). `/channels/:channelId/videos` filters on `file_name` only, via the generic `filterByFileName<T extends { file_name: string }>` (same file) — reusable by any single-chat video listing, since those items don't carry `chat_id`/`chat_title`/`channel_id`/`channel_title`. `/channels` filters on `channel_id` (exact, same `extractDigits` comparison, reused from `video-filters.ts` even though it's not video-specific) and `channel_title` (fuzzy, `includesSearchTerm`) via `matchesChannelFilters` inlined in `list-channels.route.ts`. Multiple filters on the same route combine with AND.

**Fuzzy filtering forces in-memory mode on routes with native pagination**: `/channels/:channelId/videos` normally paginates natively (Telegram returns exactly the requested page). But when `file_name` is present, the route fetches the whole `limit`-bounded set (`offset: 0`), filters it, and only then paginates in memory (`paginate()`) — a native single-page fetch can't know if a match exists outside that page's window, so filtering must happen before pagination whenever text search is involved. This is the same reasoning already covered above for why `/videos` can't paginate natively at all.

### Key implementation details worth knowing before changing streaming/auth code

- Chunking uses a fixed `CHUNK_SIZE` of 512KB (`src/routes/http-utils.js`).
- `client.iterDownload`'s `offset`/`limit` must be `big-integer` instances (the `big-integer` package), not native `BigInt` — GramJS calls `.divide()`/`.add()` on them internally, which native `BigInt` doesn't have. Passing a native `BigInt` fails silently inside the iterator and surfaces as a generic `404` from the route's catch block.
- Client disconnect is tracked (`req.on("close")`) so an aborted download stops iterating instead of continuing to pull from Telegram after the response is gone.
- `chatId` in routes is passed straight to GramJS (`getMessages`/`getEntity`); `"me"` is a GramJS-recognized shortcut for Saved Messages.
- `Content-Disposition` filenames must be ASCII-safe or the HTTP header write throws (`Invalid character in header content`), which the route's catch block turns into a misleading generic `404`. `buildContentDisposition` in `src/routes/http-utils.js` sends an ASCII-sanitized `filename=` fallback alongside a percent-encoded `filename*=UTF-8''...` (RFC 5987/6266) for the real name — needed because Telegram filenames routinely contain CJK text, emoji, etc.

### JSON field naming convention

All JSON response fields across every route use `snake_case`, lowercase (e.g. `chat_id`, `message_id`, `file_name`, `mime_type`). This applies to `/videos`, `/channels`, `/channels/:channelId/videos`, and `/list/:chatId`. Keep new fields consistent with this convention — internal JS variables/object keys inside `src/telegram-client.js` (e.g. `fileName`, `mimeType` on the intermediate `extractVideoDocument` result) can stay camelCase since they're never serialized directly; only rename at the point a field is placed into a response object.

**`chat_id`/`chat_title` vs `channel_id`/`channel_title`**: Telegram's own MTProto schema (what GramJS/this project talks to) has `Chat` and `Channel` as genuinely distinct peer types — `Channel` covers both broadcast channels and supergroups (`dialog.isChannel` in GramJS), `Chat` is a basic group. A field identifying or naming a Telegram peer is never bare `id`/`title` — but which prefix to use depends on whether the route can *only* ever return channels:

- `/channels` and `/channels/:channelId/videos` deal exclusively with peers where `dialog.isChannel` is true, so their responses use `channel_id`/`channel_title` (`ChannelListEntry`/`ChannelVideosResult` in `src/telegram-client.ts`). The route's path param is `:channelId`, not `:chatId`, for the same reason.
- `/videos` (aggregated across every dialog type) and `/list/:chatId` can return groups, private chats, or "Saved Messages" (`chatId=me`) alongside channels — calling those `channel_id`/`channel_title` would be wrong when the item isn't a channel, so they keep `chat_id`/`chat_title` (`VideoListEntry` in `src/telegram-client.ts`).

No exceptions to either rule, regardless of whether the response object also carries video-level fields (`message_id`, `file_name`, etc.) at the same level.

### `limit`/`page`/`per_page` are mandatory for Telegram-backed routes

Any new route that fetches and returns data from the Telegram API (listings, searches, anything that reads a set of items) **must** accept `limit`, `page`, and `per_page`, reusing `src/routes/pagination.ts` (`paginationQuerySchema`, `isPaginationRequested`, `resolvePagination`, `paginate`/`buildPageEnvelope`) and the `limit`-as-`per_page`-fallback wiring (`resolvePagination(query, limit)`) already used by `/videos`, `/channels`, `/channels/:channelId/videos`, and `/list/:chatId`. This is a requirement, not just documentation of existing behavior — see "Native video filtering and pagination" above for what the pattern looks like in practice.

**If a route genuinely doesn't fit** (e.g. it always returns exactly one item, or isn't a listing at all): do not decide this on your own and skip the params silently. Stop and ask the user to explicitly confirm the exception before implementing without them. Only after approval, document the exception and the reasoning where the route itself is documented. Do not pre-emptively assume other existing exceptions (`/routes`, `/video/:chatId/:messageId`, `/cache/purge`) as precedent for a new case — each one was never asked about under this rule (it postdates them) and a new case must be confirmed on its own.

### Documenting new routes

Every route lives in its own file under `src/routes/` (e.g. `list-videos.route.js`, `stream-video.route.js`), mounted in `src/routes/index.js`. Every route added must get an entry in **`docs/ROUTES.md`** with: purpose, accepted query params, and whether it's Privada (requires the `Authorization` header) or Pública/hybrid (also reachable via a signed URL, like the streaming route). `README.md` intentionally stays high-level (setup, auth model, a one-line route index linking to `docs/ROUTES.md`) — don't re-add per-route JSON examples there; that detail belongs in `docs/ROUTES.md` so the README doesn't balloon as routes are added.

**Keep `docs/insomnia/Insomnia.yaml` in sync with `docs/ROUTES.md`**: any change to `docs/ROUTES.md` (a new route, or an edit to an existing route's purpose, query params, access level, or response shape) must be mirrored the same session in the matching request inside `docs/insomnia/Insomnia.yaml` — its per-request `description` fields (and query-param `description`s) are a mirror of `docs/ROUTES.md`, not an independent source of truth. A new route also needs a new request added to the `collection` array (same pattern as the existing seven: `url`, `name`, `meta`, `method`, `parameters` with `disabled: true` placeholders, `settings`). Never let the two docs drift — `docs/ROUTES.md` is authoritative; the Insomnia file is a derived, importable copy of the same content.

### Doc file naming convention

Files whose purpose is to document something (e.g. `docs/ROUTES.md`) use `SNAKE_CASE` + uppercase. This does **not** apply to root files whose exact name/casing is mandated by external tooling — `README.md` (GitHub/npm convention), `CLAUDE.md` (loaded by Claude Code specifically), `AGENTS.md` (read by other agent tooling) keep their conventional names as-is. When adding a new doc file under `docs/`, name it accordingly (e.g. `docs/DEPLOYMENT.md`, not `docs/deployment.md` or `docs/deploy-notes.md`).

### Directory naming convention

All directories in this project use `kebab-case`, lowercase — no `PascalCase`, `camelCase`, or `snake_case` (e.g. `src`, `src/routes`, `src/types`, `docs`). This applies to any new folder added under `src/` or elsewhere in the repo. This is about folder names only — file naming has its own conventions above (`JSON field naming convention`, `Doc file naming convention`).

## Coding Patterns and Best Practices

- Functions: 4-20 lines. Split if longer.
- Files: under 500 lines. Split by responsibility.
- One thing per function, one responsibility per module (SRP).
- Names: specific and unique. Avoid `data`, `handler`, `Manager`.
  Prefer names that return <5 grep hits in the codebase.
- Types: explicit. No `any`, no `Dict`, no untyped functions.
- Use Zod for validation.
- No code duplication. Extract shared logic into a function/module.
- Early returns over nested ifs. Max 2 levels of indentation.
- Exception messages must include the offending value and expected shape.
- Do not use abbreviations in variable names, keys, function names, or file names.
- Write WHY, not WHAT. Skip `// increment counter` above `i++`.
- Reference issue numbers / commit SHAs when a line exists because of a specific bug or upstream constraint.
- Prefer types over interfaces (except when extending external types).
- Prefer functions over classes (classes only for errors/adapters).
- Prefer pure functions; when mutation is unavoidable, return the mutated object instead of void.
- Organize functions top-down: exports before helpers.
- Use JSDoc for complex functions; add tags only when justified beyond type signature.
- Use import type for types, regular import for values, separate statements even from same module.
- Prefix booleans with is/has/can/should (e.g., isValid, hasData) for clarity.
- Prefer self describing function and variable names over generic names with comments to explain their purpose.

## Git hooks

Husky manages a `pre-commit` hook (`.husky/pre-commit`) that runs, in order:

1. `npx pnpm lint-staged` — lints and formats staged files.
2. `npx pnpm typecheck` — full-project type check.
3. `npx pnpm test` — full Jest suite (see "Testing" above).

All three must pass for the commit to go through.

## Commit Guidelines

The AI agent must never perform Git history operations unless explicitly instructed.

Rules:
- Do not create commits.
- Do not amend existing commits.
- Do not squash commits.
- Do not rebase branches.
- Do not push changes.
- Do not create tags.

After completing the requested implementation:
1. Leave all changes uncommitted.
2. Present the modified files to the user.
3. Wait for the user to review and approve the changes.
4. The user is solely responsible for creating the commit and writing the commit message.

## Logging

- Structured JSON when logging for debugging / observability.
- Plain text only for user-facing CLI output.
