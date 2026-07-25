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
npx pnpm typecheck      # tsc --noEmit against src/, then again against src/+test/ via tsconfig.jest.json
```

### Testing

```bash
npx pnpm test           # run unit + int (everything except e2e) once
npx pnpm test:unit      # only test/unit — pure/near-pure logic, no HTTP
npx pnpm test:int       # only test/int — supertest + Express, telegram-client mocked
npx pnpm test:e2e       # manual, opt-in: hits the real Telegram API (see "e2e tests" below)
npx pnpm test:watch     # Jest in watch mode (unit + int)
npx pnpm test:coverage  # Jest with coverage report (unit + int)
```

### Coverage

The project requires a minimum of **90% code coverage** across all metrics (lines, branches, functions, statements). Before finishing any feature or refactor, run `npx pnpm test:coverage` and confirm the overall coverage meets this threshold. If coverage drops below 90%, add or expand tests to bring it back up before considering the work complete.

This applies to all code under `src/` — test files themselves, configuration, and generated/build output are excluded from the requirement. The coverage configuration lives in `jest.config.js`; do not lower thresholds in that config without explicit written agreement from the team.

### Login flow

`npx pnpm login` runs `src/login.js`, which prompts interactively (phone number, 2FA password, Telegram code) and prints a `TELEGRAM_SESSION` string at the end. That string must be pasted into `.env` so subsequent runs don't require re-authentication.

## Testing

TDD is the standard practice for this project: for any new feature or bugfix, write a failing test first (a unit test for pure/near-pure logic, or a supertest HTTP test for route/middleware behavior with `telegram-client.ts` mocked), watch it fail, implement the minimal change to make it pass, then refactor with the test green. There is no CI enforcement of this yet — it's a project convention backed by the pre-commit hook (see "Git hooks" below), not an automated gate beyond the local commit.

### Three layers: unit / int / e2e

Tests live under `test/`, split into three subdirectories by what they actually exercise, mirroring `src/`'s structure inside each one when practical (`test/unit/signed-url.unit.test.ts` ↔ `src/signed-url.ts`, `test/unit/cache/ttl-cache.unit.test.ts` ↔ `src/cache/ttl-cache.ts`, etc.). The filename itself carries the layer as a suffix — `<name>.unit.test.ts`, `<name>.int.test.ts`, `<name>.e2e.test.ts` — which is what `jest.config.js`'s `testMatch` uses to tell them apart, not just the directory:

- **`test/unit/`** — a module tested in isolation, no HTTP involved (pure functions, or `telegram-client.ts` itself with the low-level `telegram` package mocked).
- **`test/int/`** — `supertest` driving a real Express app (real router, real middleware) with `src/telegram-client.ts` mocked at the module boundary. Proves the wiring — query parsing, status codes, header handling, JSON shapes — without touching Telegram.
- **`test/e2e/`** — the real Telegram API, nothing mocked. See "e2e tests (API real)" below.

`npx pnpm test` runs `test/unit/` + `test/int/` only (`jest.config.js`'s `testMatch` only matches `.unit.test.ts`/`.int.test.ts`, and `testPathIgnorePatterns` excludes `test/e2e/` as a second guard) — this is what the pre-commit hook runs, so a commit never depends on network or real credentials. `npx pnpm test:unit`/`test:int` run one layer at a time (`jest test/unit`, a plain path filter). `npx pnpm test:e2e` is separate — see below.

`test/setup-env.ts` runs automatically before every `unit`/`int` test file (via `jest.config.js`'s `setupFiles`) and sets fake `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`ACCESS_TOKEN`/etc. so `src/config.ts` never throws and no real `.env` is required or touched — **`test/e2e/` deliberately does not load this file** (see below). Tests run under `ts-jest` against `tsconfig.jest.json` — a copy of `tsconfig.json` with `rootDir`/`include` widened to also cover `test/`, kept separate from the main `tsconfig.json` so `npx pnpm build` (which targets `src/` only) is unaffected; `npx pnpm typecheck` runs both, so `test/` — including `test/e2e/` — is type-checked too.

**`test/helpers/mount-router.ts`** exports `mountRouter(router, { json? })`, the standard way every `test/int/routes/*.int.test.ts` file builds its Express app (`const buildApp = () => mountRouter(someRouter)`, or `{ json: true }` for routes that read a JSON body) — don't hand-roll a local `express()` + `app.use(...)` per file.

**GramJS is always mocked in `unit`/`int`, never real** — no test outside `test/e2e/` ever calls real Telegram/MTProto:
- `test/unit/telegram-client.unit.test.ts` mocks the low-level `telegram` package (`jest.mock('telegram')`, `jest.mock('telegram/sessions')`), stubbing `TelegramClient`'s methods (`connect`, `getMessages`, `getDialogs`, `getEntity`, `iterDownload`) and `Api.InputMessagesFilterVideo` directly.
- Tests of `src/routes/**/route.ts` and `src/server.ts` mock the higher-level `src/telegram-client.ts` module instead (`jest.mock('@/telegram-client')`), stubbing its exported functions (`getVideoMessage`, `listVideos`, `listAllVideos`, `listChannels`, `getChannelVideos`) and `client.iterDownload` (returned as a fake async iterable yielding `Buffer` chunks) — these tests never reach into GramJS internals.
- `client.iterDownload`'s `offset`/`limit` arguments must always be `big-integer` instances, never native `BigInt` (see "Key implementation details" below); `test/int/routes/stream-video.route.int.test.ts` asserts this explicitly to guard against silent regressions.

**Caching between tests**: `src/cache/ttl-cache.ts` keeps its cache registry at module scope, so `test/unit/telegram-client.unit.test.ts` calls `clearAllCaches()` in `beforeEach` to stop one test's mocked `getMessages`/`getDialogs`/etc. call count from leaking into the next (Jest gives each *test file* a fresh module registry automatically, so this only matters within a single file, not across files).

`src/server.ts` exports `buildApp()` (a synchronous Express app factory with no I/O) alongside `startServer()` (the real `ensureConnected()` + `app.listen()` path used by `npx pnpm start`) precisely so tests can `request(buildApp())` with `supertest` without connecting to Telegram or binding a real port. `startServer()`/`main` only runs when `server.ts` is executed directly (`require.main === module` guard), never merely on import — this is also why `test/int/server.int.test.ts` can `jest.resetModules()` + re-`require('@/server')` inside an isolated `describe` block to exercise the dev auto-fill behavior (`config.isDev` is computed once per module load, from `process.env.NODE_ENV` at that moment) without affecting other tests in the file. The pure-function describes for `src/server.ts` (`timingSafeEqualStrings`, `extractBearerToken`, `verifySignedStream`) live separately in `test/unit/server.unit.test.ts`, since they don't need `telegram-client` mocked or an HTTP round trip.

`src/login.ts` (interactive CLI login script) is intentionally left without tests — it's a one-off manual script (prompts for phone/2FA/code, calls `process.exit`), not meaningfully unit-testable without a real Telegram account.

### e2e tests (API real)

The mocked `unit`/`int` layers protect business logic but cannot catch **contract drift**: if the `telegram` package changes its API shape in a future version, every mock still "passes" while the app breaks against the real API. `test/e2e/` exists to catch that — it is **opt-in and manual only** (`npx pnpm test:e2e`), never wired into `pnpm test`, the pre-commit hook, or any CI-equivalent, because it connects to the real account configured in `.env` and depends on live network/Telegram infrastructure. Run it by hand after upgrading the `telegram` dependency, or periodically as a sanity check.

It runs under a **separate Jest config**, `jest.e2e.config.js` (`testMatch: ['**/test/e2e/**/*.e2e.test.ts']`), for two reasons that make it unsafe to share `jest.config.js`: it deliberately has **no `setupFiles`** — loading `test/setup-env.ts`'s fake credentials would make the tests authenticate against a nonexistent account instead of the real one in `.env` — and it forces `maxWorkers: 1`, because the tests share one real Telegram account and running them in parallel triggers `FLOOD_WAIT`.

**One file per capability**, each independent and runnable on its own (`npx pnpm test:e2e -- list-videos`): `list-channels.e2e.test.ts`, `upload-video.e2e.test.ts`, `list-videos.e2e.test.ts`, `channel-videos.e2e.test.ts`, `stream-video.e2e.test.ts`, `edit-video.e2e.test.ts`, `delete-video.e2e.test.ts`. Each uses `describe.each` from `test/e2e/helpers/video-fixture.ts`'s `TARGETS` (`"me"`/Saved Messages, and `SMOKE_TEST_CHANNEL_ID`, see "Configuration" below) to run against both — real channel coverage is what caught the entity-resolution bug that only manifested against a channel, never against `"me"`.

`test/e2e/helpers/video-fixture.ts` centralizes `uploadFixture(chatId)`/`removeFixture(chatId, messageId)` (thin wrappers over the real `uploadVideo`/`deleteVideoMessage` from `@/telegram-client`) and the shared constants (`TEST_VIDEO_PATH`, `TARGETS`, description strings). Most files upload a fixture in `beforeAll` and delete it in `afterAll`; `upload-video.e2e.test.ts` and `delete-video.e2e.test.ts` upload/delete inside the `it` itself, since that operation *is* the thing under test.

**Each file must call `client.disconnect()` in a file-level `afterAll`** (registered once, outside any `describe.each`, so it runs after all targets in that file — not per target, which would leave the shared `TelegramClient` singleton's `connected` flag stuck `true` after an early disconnect and break the next target's `ensureConnected()`). Skipping this leaves the GramJS socket open and the Jest process hangs after the last test.

A full `test:e2e` run does ~11 real uploads of the ~17MB fixture (~20s each against `"me"`, ~65s against a channel — measured) — roughly 8 minutes. That cost is why it's manual-only and why each file uploads its own fixture rather than sharing one: isolation over speed, since this only runs by hand.

## Configuration

Copy `.env.example` to `.env` and set:

- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` — from https://my.telegram.org → "API Development Tools"
- `TELEGRAM_SESSION` — produced by `npx pnpm login`
- `PORT` — HTTP port (default 8787)
- `ACCESS_TOKEN` — shared secret required via `Authorization: Bearer ...` on every request; also used as the HMAC key for signed streaming URLs (see below). Treat it as a password.
- `NODE_ENV` — must be exactly `development` to enable the dev auto-fill behavior described below; any other value (including unset) is treated as strict/production
- `CACHE_TTL_MS` — how long (ms) read results from `telegram-client.ts` stay cached in memory (default `180000`, 3 min). See "Caching and fetch concurrency" below.
- `TELEGRAM_FETCH_CONCURRENCY` — max chats fetched in parallel by `listAllVideos` (default `5`). Higher values speed up `/api/v1/videos/grouped` but raise the risk of hitting Telegram's `FLOOD_WAIT`.
- `SMOKE_TEST_CHANNEL_ID` — channel `npx pnpm test:e2e` uses to also round-trip list/upload/edit/delete against a real channel, not just Saved Messages (default `-1004325653681`). Must keep the `-100` prefix — GramJS reads a plain positive ID as a user (`PeerUser`), not a channel, and entity resolution fails. Only read by `test/e2e/helpers/video-fixture.ts`, never by the server itself — swap it to any channel the logged-in account can post/delete in.

`src/config.js` centralizes env parsing and throws immediately if `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` are missing.

## Architecture

- `src/config.js` — loads and validates env vars via dotenv.
- `src/telegram-client.js` — owns the single shared `TelegramClient` instance (GramJS) and all Telegram-facing logic: connecting once (`ensureConnected`, lazy singleton), resolving video documents out of messages (`extractVideoDocument`), and read/write operations (`listVideos`, `listAllVideos`, `listChannels`, `getVideoMessage`, `uploadVideo`, `editVideoCaption`, `deleteVideoMessage`). All routes go through this module rather than touching GramJS directly. Read operations are wrapped in the TTL cache described below.
- `src/cache/ttl-cache.js` — generic in-memory TTL cache (`createTtlCache`) plus `withCache`.
- `src/router.js` — composes every endpoint router and is mounted by `src/server.js` at `/api/v1`.
- `src/routes/` — route segment tree only. Every endpoint file must be named `route.ts` and must mirror the public path segments as closely as Express allows. Example: `/api/v1/cache/purge` lives at `src/routes/cache/purge/route.ts`; `/api/v1/video/delete/:chatId/:messageId` lives at `src/routes/video/delete/route.ts`.
- `src/routes/` must not contain helpers, utils, services, hooks, or shared implementation files. Put reusable route support under `src/http`, `src/utils`, `src/services`, or another non-`routes` directory that matches the responsibility. Keep `src/routes/**/route.ts` focused on parsing the request, calling services, and returning the response.
- `src/http/video-response.js` and `src/http/video-stream.js` — shared HTTP/video response helpers, including Range parsing, safe `Content-Disposition`, chunk size, MIME safety, and shared stream/download behavior.
- `src/signedUrl.js` — `createSignedUrl`/`verifySignedUrl`: HMAC-SHA256 over `chatId:messageId:exp`, 1h TTL. Generated URLs point to `/api/v1/video/stream/...`.
- `src/login.js` — standalone script for the one-time interactive login described above.

### Auth: header vs signed query params

`requireToken` in `src/server.js` reads the token from `Authorization: Bearer <token>` by default — this covers every route. The only exceptions are `/api/v1/video/stream/:chatId/:messageId` and `/api/v1/video/dl/:chatId/:messageId`, which also accept signed, time-limited query params (`?exp=...&sig=...`, verified with `verifySignedUrl`). They are direct URL endpoints for VLC, browser `<video src>`, and downloads, where custom headers are often unavailable. They deliberately do **not** accept the raw master token in the query string. Discovery/write/cache routes require the header only; when handlers embed a ready-to-use video URL in JSON, they call `createSignedUrl(base, chatId, messageId)` rather than reflecting any token from the request.

**Dev auto-fill, fail-closed by design:** if `config.isDev` (`NODE_ENV === "development"`, exact match — not just "truthy" or "not production") and the incoming request has no `Authorization` header, `requireToken` injects `Bearer <ACCESS_TOKEN>` automatically before checking it, so local testing doesn't require passing the header on every call. Any other `NODE_ENV` value, including unset, skips this and enforces the header strictly. This was a deliberate choice after considering the alternative (`isDev` defaulting to true unless `NODE_ENV=production`): defaulting to open is a common footgun if a real deployment forgets to set `NODE_ENV` — this codebase defaults to strict instead.

### Request flow

1. Every request must include valid credentials (checked via constant-time comparison in `server.js`) — `Authorization: Bearer <ACCESS_TOKEN>` everywhere, or signed `?exp=...&sig=...` on stream/download only; requests without either get `401`.
2. `/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`, and `/api/v1/channels` are discovery endpoints that return JSON. Video listings include ready-to-use `/api/v1/video/stream/...` URLs with signed, expiring query params.
3. `/api/v1/video/stream/:chatId/:messageId` streams inline when safe; `/api/v1/video/dl/:chatId/:messageId` forces download. Both honor `Range` and pull bytes lazily via `iterDownload`, without buffering the full file or writing it to disk.

### Caching and fetch concurrency

Every read function exported by `src/telegram-client.js` (`listChannels`, `listVideos`, `getChannelVideos`, `listAllVideos`, `getVideoMessage`) is wrapped with `withCache` from `src/cache/ttl-cache.js`: the function's actual body lives in a `*Uncached` variant, and the exported name is `withCache(config.cacheTtlMs, keyFn, fooUncached)`. The cache is in-memory, keyed per function, and dedupes concurrent identical requests. Repeated requests to `/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`, and `/api/v1/channels` come back near-instant within the TTL window (`CACHE_TTL_MS`), at the cost of listings being up to that long out of date after a new video is sent on Telegram.

`getVideoMessage` (used by stream/download to resolve `chatId:messageId` → document/size/mimeType/fileName) is cached the same way, keyed by `` `${chatId}:${messageId}` ``. The actual byte transfer (`client.iterDownload` in `src/http/video-stream.ts`) is **never** cached — only the metadata lookup is.

`listAllVideos` additionally fetches chats in parallel (bounded by `TELEGRAM_FETCH_CONCURRENCY`, via `p-limit`) instead of the previous one-chat-at-a-time loop. `p-limit` is pinned to `3.1.0` — versions 4+ are ESM-only and break this CommonJS project.

**Adding a new read function that should be cached**: don't hand-roll `getOrSet` calls — write the function body as `*Uncached`, then export `withCache(config.cacheTtlMs, keyFn, fooUncached)`, matching the existing five. This is what makes the caching "global": any new route that reuses an existing `telegram-client.js` function inherits caching automatically; a genuinely new fetch only needs this one extra line.

**Manual purge**: `POST /api/v1/cache/purge` (`src/routes/cache/purge/route.ts`) calls `clearAllCaches()` from `src/cache/ttl-cache.js`, which clears every cache's `store`/`pending` maps. A new cached function automatically becomes purge-able the moment it's wrapped in `createTtlCache`/`withCache`.

### Native video filtering and pagination

`listVideos` (used by `/api/v1/videos/by/:chatId`) and `fetchDialogVideos`/`listAllVideos`'s per-chat fetch (used by `/api/v1/videos/grouped`) call `tg.getMessages(chatId, { filter: new Api.InputMessagesFilterVideo(), limit, addOffset })` instead of fetching raw messages and locally guessing which ones are videos. `Api.InputMessagesFilterVideo` is a Telegram server-side filter — it excludes video notes and GIFs and returns a `TotalList` whose `.total` is the real count of matching videos in that chat, not an estimate.

`/api/v1/videos/by/:chatId` uses this for **true native pagination** when `file_name` is absent: `addOffset = (page - 1) * per_page`, `limit = per_page`. With `file_name`, the route fetches up to `limit`, filters in memory, and then paginates so matches outside a single native page are not missed.

`/api/v1/videos/grouped` (aggregated across every dialog) **cannot** do this — there's no single Telegram call that paginates "all videos across all chats" with one cursor. It still fetches up to `limit` videos **per chat** this way (parallel, cached, same as before) — `limit` here is *not* a total cap on the response, it's the `limit` sent to each per-chat native call, so `?limit=1` with 26 chats that have videos returns 26 items (one per chat), not one. When `page`/`per_page` are supplied the cut is done in memory over the already-aggregated-and-filtered array (`paginate()` in `src/utils/pagination.ts`) — this shrinks the response, not the number of Telegram calls.

`/api/v1/channels` (the plain dialog list) also takes `limit` (default `100`), passed straight to `tg.getDialogs({ limit })` (`listChannelsUncached` in `src/telegram-client.ts`). Unlike the video filter, Telegram's dialog list has no server-side "channels only" filter, so `limit` caps **dialogs scanned in total** (channels + groups + DMs), not channels returned — `?limit=5` can return fewer than 5 channels if some of the 5 most recent dialogs aren't channels. Pagination on `/api/v1/channels` is the same in-memory `paginate()` as `/api/v1/videos/grouped`, applied after that scan-and-filter step.

**Response shape, `limit` vs `page`/`per_page`**: all four listing routes accept `limit` (default `100` — how much is fetched/considered, semantics vary by route as described above) and `page`/`per_page` (`per_page` capped at `100` — how the response is sliced). Omitting both `page` and `per_page` returns a flat array/object exactly like before this feature existed (respecting `limit`) — pagination mode, with the `{ data, page, per_page, total, total_pages }` envelope, only activates when at least one of `page`/`per_page` is present (`src/utils/pagination.ts`: `isPaginationRequested`/`resolvePagination`/`buildPageEnvelope`). `limit` isn't just for flat mode: `resolvePagination(query, defaultPerPage)` takes the route's `limit` as `defaultPerPage`, so passing only `page` (no `per_page`) still honors `limit` as the page size instead of silently falling back to a hardcoded `20` — `per_page`, when explicitly given, always wins over `limit`. Signed URLs (`createSignedUrl`) are only generated for the items actually in the response, never for a full unpaginated list when a page was requested.

### Text filtering (fuzzy, accent/case-insensitive)

`src/utils/text-search.ts` exports `normalizeForSearch` (NFD-normalize, strip diacritics, lowercase, trim) and `includesSearchTerm` (normalizes both sides, then `includes`) — this is the one substring-match implementation every route-level filter is built on; don't reimplement normalization elsewhere.

`/api/v1/videos/grouped` filters on `chat_id` (exact match, digits-only comparison via `extractDigits` in `src/services/videos/filters.ts`), `chat_title`, and `file_name`. `/api/v1/videos/by/:chatId` filters on `file_name` only, via `filterByFileName`. `/api/v1/channels` filters on `channel_id` and `channel_title`. Multiple filters on the same route combine with AND.

**Fuzzy filtering forces in-memory mode on routes with native pagination**: `/api/v1/videos/by/:chatId` normally paginates natively. When `file_name` is present, it fetches the whole `limit`-bounded set (`offset: 0`), filters it, and only then paginates in memory (`paginate()`).

### Key implementation details worth knowing before changing streaming/auth code

- Chunking uses a fixed `CHUNK_SIZE` of 512KB (`src/http/video-response.js`).
- `client.iterDownload`'s `offset`/`limit` must be `big-integer` instances (the `big-integer` package), not native `BigInt` — GramJS calls `.divide()`/`.add()` on them internally, which native `BigInt` doesn't have. Passing a native `BigInt` fails silently inside the iterator and surfaces as a generic `404` from the route's catch block.
- Client disconnect is tracked (`req.on("close")`) so an aborted download stops iterating instead of continuing to pull from Telegram after the response is gone.
- `chatId` in routes is passed straight to GramJS (`getMessages`/`getEntity`); `"me"` is a GramJS-recognized shortcut for Saved Messages.
- `Content-Disposition` filenames must be ASCII-safe or the HTTP header write throws (`Invalid character in header content`), which the route's catch block turns into a misleading generic `404`. `buildContentDisposition` in `src/http/video-response.js` sends an ASCII-sanitized `filename=` fallback alongside a percent-encoded `filename*=UTF-8''...` (RFC 5987/6266) for the real name — needed because Telegram filenames routinely contain CJK text, emoji, etc.

### JSON field naming convention

All JSON response fields across every route use `snake_case`, lowercase (e.g. `chat_id`, `message_id`, `file_name`, `mime_type`). This applies to `/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`, `/api/v1/channels`, upload/update/delete responses, and any new route. Internal JS variables can stay camelCase when they are not serialized directly.

**`chat_id`/`chat_title` vs `channel_id`/`channel_title`**: Telegram's own MTProto schema (what GramJS/this project talks to) has `Chat` and `Channel` as genuinely distinct peer types — `Channel` covers both broadcast channels and supergroups (`dialog.isChannel` in GramJS), `Chat` is a basic group. A field identifying or naming a Telegram peer is never bare `id`/`title` — but which prefix to use depends on whether the route can *only* ever return channels:

- `/api/v1/channels` deals exclusively with peers where `dialog.isChannel` is true, so its response uses `channel_id`/`channel_title`.
- `/api/v1/videos/grouped` can return any dialog type and uses `chat_id`/`chat_title`.
- `/api/v1/videos/by/:chatId` accepts any peer id, username, or `"me"` and uses `chat_id` in the response envelope, not `channel_id`.

No exceptions to either rule, regardless of whether the response object also carries video-level fields (`message_id`, `file_name`, etc.) at the same level.

### `limit`/`page`/`per_page` are mandatory for Telegram-backed routes

Any new route that fetches and returns data from the Telegram API (listings, searches, anything that reads a set of items) **must** accept `limit`, `page`, and `per_page`, reusing `src/utils/pagination.ts` (`paginationQuerySchema`, `isPaginationRequested`, `resolvePagination`, `paginate`/`buildPageEnvelope`) and the `limit`-as-`per_page` fallback already used by `/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`, and `/api/v1/channels`.

**If a route genuinely doesn't fit** (e.g. it always returns exactly one item, or isn't a listing at all): do not decide this on your own and skip the params silently. Stop and ask the user to explicitly confirm the exception before implementing without them. Only after approval, document the exception and the reasoning where the route itself is documented.

### Documenting new routes

Every route lives in a `route.ts` under `src/routes/`, following the public path segments after `/api/v1` as closely as possible. Every route added must get an entry in **`docs/ROUTES.md`** with purpose, accepted query params, and whether it is Privada or Híbrida. `README.md` intentionally stays high-level (setup, auth model, and a short route index linking to `docs/ROUTES.md`) — don't re-add per-route JSON examples there.

**Keep `docs/insomnia/Insomnia.yaml` in sync with `docs/ROUTES.md`**: any change to `docs/ROUTES.md` (a new route, or an edit to an existing route's purpose, query params, access level, or response shape) must be mirrored the same session in the matching request inside `docs/insomnia/Insomnia.yaml` — its per-request `description` fields (and query-param `description`s) are a mirror of `docs/ROUTES.md`, not an independent source of truth. A new route also needs a new request added to the `collection` array (same pattern as the existing seven: `url`, `name`, `meta`, `method`, `parameters` with `disabled: true` placeholders, `settings`). Never let the two docs drift — `docs/ROUTES.md` is authoritative; the Insomnia file is a derived, importable copy of the same content.

### Doc file naming convention

Files whose purpose is to document something (e.g. `docs/ROUTES.md`) use `SNAKE_CASE` + uppercase. This does **not** apply to root files whose exact name/casing is mandated by external tooling — `README.md` (GitHub/npm convention), `CLAUDE.md` (loaded by Claude Code specifically), `AGENTS.md` (read by other agent tooling) keep their conventional names as-is. When adding a new doc file under `docs/`, name it accordingly (e.g. `docs/DEPLOYMENT.md`, not `docs/deployment.md` or `docs/deploy-notes.md`).

### Directory naming convention

All directories in this project use `kebab-case`, lowercase — no `PascalCase`, `camelCase`, or `snake_case` (e.g. `src`, `src/routes`, `src/types`, `docs`). This applies to any new folder added under `src/` or elsewhere in the repo. This is about folder names only — file naming has its own conventions above (`JSON field naming convention`, `Doc file naming convention`).

### Import paths (absolute)

Imports that cross out of the current directory use an absolute alias — `@/*` for `src/*`, `@test/*` for `test/*` — never `../..`. Imports within the same directory stay relative (`./http-utils`). The aliases are declared in four places that must stay in sync: `tsconfig.json` (`paths`), `tsconfig.jest.json` (redeclares both entries — `paths` replaces rather than merges when extending a base config), and `jest.config.js`/`jest.e2e.config.js` (`moduleNameMapper`, because ts-jest doesn't read `paths` on its own). The build is `tsc && tsc-alias`: `tsc` alone type-checks `@/*` correctly but never rewrites it in the emitted JS, and `npx pnpm start` runs `dist/server.js` directly — without `tsc-alias`, the compiled output would `require("@/config")` and fail at runtime with no compile-time warning.

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
3. `npx pnpm test` — unit + int suite (see "Testing" above). Never `test:e2e` — that layer hits the real Telegram API and stays opt-in/manual, never gated on a commit.

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
