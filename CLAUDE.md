# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An HTTP server that streams videos stored in Telegram (private channels or "Saved Messages") over HTTP with Range-request support, so any HTTP-capable player (VLC, browser `<video>`) can seek into them. It authenticates to Telegram as a **user account** via MTProto (TeleProto), not the Bot API, because the Bot API cannot see private channel history or Saved Messages, and it caps downloads at 20MB.

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

- **`test/unit/`** — a module tested in isolation, no HTTP involved (pure functions, or `telegram-client.ts` itself with the low-level `teleproto` package mocked).
- **`test/int/`** — `supertest` driving a real Express app (real router, real middleware) with `src/telegram-client.ts` mocked at the module boundary. Proves the wiring — query parsing, status codes, header handling, JSON shapes — without touching Telegram.
- **`test/e2e/`** — the real Telegram API, nothing mocked. See "e2e tests (API real)" below.

`npx pnpm test` runs `test/unit/` + `test/int/` only (`jest.config.js`'s `testMatch` only matches `.unit.test.ts`/`.int.test.ts`, and `testPathIgnorePatterns` excludes `test/e2e/` as a second guard) — this is what the pre-commit hook runs, so a commit never depends on network or real credentials. `npx pnpm test:unit`/`test:int` run one layer at a time (`jest test/unit`, a plain path filter). `npx pnpm test:e2e` is separate — see below.

`test/setup-env.ts` runs automatically before every `unit`/`int` test file (via `jest.config.js`'s `setupFiles`) and sets fake `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`ACCESS_TOKEN`/etc. so `src/config.ts` never throws and no real `.env` is required or touched — **`test/e2e/` deliberately does not load this file** (see below). Tests run under `ts-jest` against `tsconfig.jest.json` — a copy of `tsconfig.json` with `rootDir`/`include` widened to also cover `test/`, kept separate from the main `tsconfig.json` so `npx pnpm build` (which targets `src/` only) is unaffected; `npx pnpm typecheck` runs both, so `test/` — including `test/e2e/` — is type-checked too.

**`test/helpers/mount-router.ts`** exports `mountRouter(router, { json? })`, the standard way every `test/int/routes/*.int.test.ts` file builds its Express app (`const buildApp = () => mountRouter(someRouter)`, or `{ json: true }` for routes that read a JSON body) — don't hand-roll a local `express()` + `app.use(...)` per file.

**TeleProto is always mocked in `unit`/`int`, never real** — no test outside `test/e2e/` ever calls real Telegram/MTProto:
- `test/unit/telegram-client.unit.test.ts` mocks the low-level `teleproto` package (`jest.mock('teleproto')`, `jest.mock('teleproto/sessions')`), stubbing `TelegramClient`'s methods (`connect`, `getMessages`, `getDialogs`, `getEntity`, `uploadFile`, `sendFile`, `downloadMedia`) and `Api.InputMessagesFilterVideo` directly.
- Tests of `src/routes/**/route.ts` and `src/server.ts` mock the higher-level `src/telegram-client.ts` module instead (`jest.mock('@/telegram-client')`), stubbing its exported functions (`getVideoMessage`, `listVideos`, `listAllVideos`, `listChannels`, `getChannelInfo`, `getChannelVideos`) and the `client._media.getFile(dcId, location, offset, limit, signal)` path used by streaming.
- Streaming offset tests must assert that `_media.getFile` receives the document's `dcId`, a `big-integer` aligned offset, and `CHUNK_SIZE` as the Telegram request size; this guards the seekable HTTP Range contract.

**Caching between tests**: `src/cache/ttl-cache.ts` keeps its cache registry at module scope, so `test/unit/telegram-client.unit.test.ts` calls `clearAllCaches()` in `beforeEach` to stop one test's mocked `getMessages`/`getDialogs`/etc. call count from leaking into the next (Jest gives each *test file* a fresh module registry automatically, so this only matters within a single file, not across files).

`src/server.ts` exports `buildApp()` (a synchronous Express app factory with no I/O) alongside `startServer()` (the real `ensureConnected()` + `app.listen()` path used by `npx pnpm start`) precisely so tests can `request(buildApp())` with `supertest` without connecting to Telegram or binding a real port. `startServer()`/`main` only runs when `server.ts` is executed directly (`require.main === module` guard), never merely on import — this is also why `test/int/server.int.test.ts` can `jest.resetModules()` + re-`require('@/server')` inside an isolated `describe` block to exercise the dev auto-fill behavior (`config.isDev` is computed once per module load, from `process.env.NODE_ENV` at that moment) without affecting other tests in the file. The pure-function describes for `src/server.ts` (`timingSafeEqualStrings`, `extractBearerToken`, `verifySignedStream`) live separately in `test/unit/server.unit.test.ts`, since they don't need `telegram-client` mocked or an HTTP round trip.

`src/login.ts` (interactive CLI login script) is intentionally left without tests — it's a one-off manual script (prompts for phone/2FA/code, calls `process.exit`), not meaningfully unit-testable without a real Telegram account.

### e2e tests (API real)

The mocked `unit`/`int` layers protect business logic but cannot catch **contract drift**: if the `teleproto` package changes its API shape in a future version, every mock still "passes" while the app breaks against the real API. `test/e2e/` exists to catch that — it is **opt-in and manual only** (`npx pnpm test:e2e`), never wired into `pnpm test`, the pre-commit hook, or any CI-equivalent, because it connects to the real account configured in `.env` and depends on live network/Telegram infrastructure. Run it by hand after upgrading the `teleproto` dependency, or periodically as a sanity check.

It runs under a **separate Jest config**, `jest.e2e.config.js` (`testMatch: ['**/test/e2e/**/*.e2e.test.ts']`), for reasons that make it unsafe to share `jest.config.js`: it deliberately has **no `setupFiles`** — loading `test/setup-env.ts`'s fake credentials would make the tests authenticate against a nonexistent account instead of the real one in `.env` — it forces `maxWorkers: 1` because the tests share one real Telegram account and running them in parallel triggers `FLOOD_WAIT` (running two `test:e2e` invocations concurrently is just as unsafe — they'd race on the same account, so never run more than one at a time), a generous `testTimeout` (`1_200_000`ms) to cover the large fixture's upload time, and `forceExit: true` — even after `client.destroy()` (see below) stops TeleProto's internal update loop, each `TelegramClient` may still hold connections to more than one datacenter (main + the one used for the large fixture's upload/download), and each can schedule disconnect-confirmation timers that fire a second or two after `destroy()` already resolved; `forceExit` stops the process as soon as results are reported instead of waiting on those.

**One file per route, driven entirely through HTTP** (`supertest` + `buildApp()` from `@/server`, never `telegram-client.ts` functions directly) — this is the same code path a real client hits, so it also catches Express-wiring bugs (query parsing, status codes, auth) that mocked `int` tests can't, since those mount only the bare sub-router, not the full app with `requireToken`. `test/e2e/helpers/http-client.ts` exports a single `app = buildApp()` and an `authed(req)` wrapper that sets `Authorization: Bearer <ACCESS_TOKEN>` from the real `config`; every file does `authed(request(app).get(...))`. **This applies without exception to `afterAll` cleanup too, not just the primary assertions** — a test file must never import and call a service function (`telegram-client.ts` or otherwise) to set up preconditions or tear down a fixture. The one narrow, deliberate exception is `removeFixture` in `test/e2e/helpers/video-fixture.ts`, used only by `delete-video.e2e.test.ts`'s own cleanup (see below) specifically because that file tests the delete route itself — cleaning up through that same route would make the safety net fail for the same reason the test does, leaving a real orphaned message on the account. Every other file's cleanup uses `deleteFixtureViaApi` (same file, HTTP-based) instead.

**Every file in `test/e2e/` is independent and self-contained** — each one creates its own fixture (via `POST /api/v1/video/upload/:chatId`, through the real route) in a `beforeAll`, runs its assertions, and destroys that same fixture in an `afterAll`, with no dependency on any other file having run first or on any fixed execution order. There is no `testSequencer` configured in `jest.e2e.config.js` — Jest's default ordering is fine because nothing depends on it. `test/e2e/helpers/upload-fixture.ts` centralizes this: `uploadTestFixture(chatId, filePath, opts?)` POSTs the upload and polls `pollUploadJobUntilSettled` until the job leaves `queued`/`uploading`, returning the settled job (including `message_id`) — every file that needs its own fixture uses this instead of hand-rolling upload+poll logic.

Two files need no fixture at all: `list-channels.e2e.test.ts` and `channel-detail.e2e.test.ts` only query channel/dialog metadata that already exists on the account independent of any test-created video, so they don't upload or clean up anything.

`test/e2e/helpers/video-fixture.ts` centralizes `TARGETS` (`"me"`/Saved Messages and `SMOKE_TEST_CHANNEL_ID`, see "Configuration" below), the description constants, `removeFixture`, `deleteFixtureViaApi`, and `buildSmallThumbnailBuffer()`. Two video fixtures are tracked, and which file uses which is deliberate:

- **`TEST_VIDEO_PATH`** (`src/_assets/sample/15158346_3840_2160_60fps.mp4`, ~177MB, 4K/60fps) — used only by `upload-video.e2e.test.ts` (it's the upload route itself being tested) and by `stream-video.e2e.test.ts`/`download-video.e2e.test.ts` (deliberately much larger than a synthetic buffer so the Range/chunked-streaming tests exercise many real `CHUNK_SIZE` iterations, not a handful of bytes).
- **`TEST_QUEUE_VIDEO_PATH`** (`src/_assets/sample/file_example_MP4_1920_18MG.mp4`, ~18MB) — used by every other file that needs a fixture (`update-video`, `videos-grouped`, `videos-by-chat`, `purge-cache`, `delete-video`, plus the 5 queue-control files below), since they don't assert on exact bytes of a large file and a smaller upload is faster.
- `buildSmallThumbnailBuffer()`'s source, `src/_assets/sample/file_example_JPG_1MB.jpg`, is **resized to ≤320×320 via `sharp`** before being attached — the Telegram API expects a small thumbnail and rejects the original 3800×2534/~1MB file as-is.

**`src/_assets/sample/*.mp4` and `*.jpg` are tracked via Git LFS** (`.gitattributes` at the repo root), not as regular blobs — the 4K fixture alone is ~177MB, over GitHub's 100MB per-file limit. Anyone cloning the repo needs `git lfs install` (one-time, per machine) for these files to check out as real binary content instead of small pointer text files; run `git lfs pull` if a checkout ever leaves them as pointers (e.g. after a fresh clone if a global `git config` disables the smudge filter's automatic download, such as `smudge = git-lfs smudge --skip`).

Because the fixture is large, `stream-video.e2e.test.ts`/`download-video.e2e.test.ts` mostly assert against a small byte-exact `Range` slice (`bytes=0-65535`) compared against the same slice read from the local file, rather than re-downloading the full ~177MB on every assertion; the one full, unranged download (200, full `Content-Length`, full-buffer equality) runs once, only against `"me"` (the faster target), which is enough to prove that code path without paying for it everywhere. Both routes share `streamTelegramVideo` (`src/services/videos/stream.ts`) and only differ in `Content-Disposition` (`inline` vs `attachment`); both also get a signed-url-without-`Authorization`-header check (`createSignedUrl` from `@/signed-url`, swapping `/video/stream/` for `/video/dl/` when needed, since the signature covers only `chatId:messageId:exp`, not the path) and a tampered-signature-rejects-with-401 check — this bypass path existed before but had never been exercised end-to-end against a real upload until now.

**Each file must call `client.destroy()` (not `client.disconnect()`) in a file-level `afterAll`** (registered once, outside any `describe.each`, so it runs after all targets in that file — not per target, which would leave the shared `TelegramClient` singleton's `connected` flag stuck `true` after an early disconnect and break the next target's `ensureConnected()`). `disconnect()` alone may leave TeleProto's internal update loop/timers alive after a suite finishes, producing timeout/logging noise and keeping the process open. `destroy()` is the shutdown path used by the e2e suite.

A full `test:e2e` run does around 15 real uploads across the two targets ("me" + the test channel): 6 large ones (~177MB, from `upload-video`/`stream-video`/`download-video`, 2 targets each) and roughly 9 small ones (~18MB, from `update-video`/`videos-grouped`/`videos-by-chat`/`purge-cache`/`delete-video`, `purge-cache` only against the channel target). This is a deliberate trade-off favoring per-file isolation over total run time — each file is fully self-contained and can be run alone (`npx pnpm test:e2e -- <name>`) without any other file having run first, at the cost of repeating the upload/cleanup round trip in every file that needs its own fixture.

**Upload queue-control routes (`cancel`/`pause`/`resume`/`pause-all`/`resume-all`) are covered by 5 separate, self-contained files** — `upload-cancel.e2e.test.ts`, `upload-pause.e2e.test.ts`, `upload-resume.e2e.test.ts`, `upload-pause-all.e2e.test.ts`, `upload-resume-all.e2e.test.ts` — following the same independent-file pattern as every other file in `test/e2e/`. What's being tested is concurrent-job behavior (a job queued behind another one that's actively uploading), which structurally requires each file to create its own real, in-flight upload to occupy the single concurrency slot (`UPLOAD_CONCURRENCY_LIMIT`, default `1`) before it can exercise cancel/pause/resume on a job stuck behind it — a single shared fixture wouldn't work here even if one existed. Each file uses `TEST_QUEUE_VIDEO_PATH` (~18MB, also Git-LFS-tracked, see above) — still large enough to give a real time window for a queued/in-flight job to be acted on, but far cheaper given how many uploads these tests need (up to 3 real completed uploads per file per target). A job that only ever goes `queued`→`cancelled` or `queued`→`paused` (never resumed) never actually calls `uploadVideo` — the scheduler (`src/services/videos/upload-scheduler.ts`) discards it without running — so there's nothing to clean up for those; each file's `afterAll` calls `deleteFixtureViaApi` (in `try/catch` per item) only for the jobs that actually completed a real upload.

## Configuration

Every new environment variable added to the project must also be added to `.env.sample` (with a brief comment) so the sample file stays a complete reference. The validation schema in `src/config.ts` is the authoritative list — `.env.sample` mirrors it for documentation and onboarding.

Copy `.env.sample` to `.env` and set:

- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` — from https://my.telegram.org → "API Development Tools". **Required** — the server refuses to start without them.
- `TELEGRAM_SESSION` — produced by `npx pnpm login`. Optional/empty on first run — that's the whole point of `npx pnpm login`, which only needs `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`ACCESS_TOKEN` to already be set.
- `PORT` — HTTP port (default 8787)
- `ACCESS_TOKEN` — shared secret required via `Authorization: Bearer ...` on every request; also used as the HMAC key for signed streaming URLs (see below). Treat it as a password. **Required** — the server refuses to start without it (an empty/missing token would otherwise silently leave header auth impossible to satisfy).
- `NODE_ENV` — must be exactly `development` to enable the dev auto-fill behavior described below; any other value (including unset) is treated as strict/production
- `CACHE_TTL_MS` — how long (ms) read results from `telegram-client.ts` stay cached in memory (default `180000`, 3 min). See "Caching and fetch concurrency" below.
- `TELEGRAM_FETCH_CONCURRENCY` — max chats fetched in parallel by `listAllVideos` (default `5`). Higher values speed up `/api/v1/videos/grouped` but raise the risk of hitting Telegram's `FLOOD_WAIT`.
- `UPLOAD_CONCURRENCY_LIMIT` — max real uploads (`tg.uploadFile`/`tg.sendFile`) running in parallel against the Telegram account (default `1`). Same `FLOOD_WAIT` risk as `TELEGRAM_FETCH_CONCURRENCY`, but for writes — requests beyond the limit keep their job in `queued` status (see `POST /api/v1/video/upload/:chatId` in `docs/ROUTES.md`) until a slot frees up.
- `UPLOAD_PROGRESS_TTL_MINUTES` — how long (minutes) a completed/failed upload job stays queryable via `GET /api/v1/video/upload/progress/:jobId` before being cleared from memory (default `5`). Converted to ms once in `src/config.ts` (`config.uploadProgressTtlMs`) — the rest of the codebase only ever sees the ms value.
- `SMOKE_TEST_CHANNEL_ID` — channel `npx pnpm test:e2e` uses to also round-trip list/upload/edit/delete against a real channel, not just Saved Messages. **Required, no default** — `test/e2e/helpers/video-fixture.ts` throws immediately at import time if unset, the same fail-closed pattern `src/config.ts` uses for its required vars. Must keep the `-100` prefix — TeleProto reads a plain positive ID as a user (`PeerUser`), not a channel, and entity resolution fails. Only read by `test/e2e/helpers/video-fixture.ts`, never by the server itself — set it to any channel the logged-in account can post/delete in.

All of the above (except `SMOKE_TEST_CHANNEL_ID`, which bypasses `config.ts` entirely) are validated by a Zod schema in `src/config.ts` at import time — the process throws immediately, listing every offending var, if a required var is missing/empty or a numeric var isn't a valid finite number (e.g. `PORT=abc`). This runs before `npx pnpm start`'s `app.listen()` and before `npx pnpm login`, since both import `src/config.ts` as their first step.

`src/config.js` centralizes env parsing and validation (Zod schema, see above).

## Architecture

- `src/config.js` — loads and validates env vars via dotenv.
- `src/telegram-client.js` — owns the single shared `TelegramClient` instance (TeleProto) and all Telegram-facing logic: connecting once (`ensureConnected`, lazy singleton), resolving video documents out of messages (`extractVideoDocument`), and read/write operations (`listVideos`, `listAllVideos`, `listChannels`, `getChannelInfo`, `getVideoMessage`, `uploadVideo`, `editVideoCaption`, `deleteVideoMessage`). All routes go through this module rather than touching TeleProto directly. Read operations are wrapped in the TTL cache described below.
- `src/services/videos/telegram-range.js` — TeleProto MediaScheduler helper used by stream/download to fetch byte windows by `offset`/`limit`.
- `src/utils/ttl-cache.js` — generic in-memory TTL cache (`createTtlCache`) plus `withCache`.
- `src/router.js` — composes every endpoint router and is mounted by `src/server.js` at `/api/v1`.
- `src/routes/` — route segment tree only. Every endpoint file must be named `route.ts` and must mirror the public path segments as closely as Express allows. Example: `/api/v1/cache/purge` lives at `src/routes/cache/purge/route.ts`; `/api/v1/video/delete/:chatId/:messageId` lives at `src/routes/video/delete/route.ts`.
- `src/routes/` must not contain helpers, utils, services, hooks, or shared implementation files. Put reusable route support under `src/utils` or `src/services` only. Keep `src/routes/**/route.ts` focused on parsing the request, calling services, and returning the response.
- `src/utils/http-response.js` — HTTP protocol utilities (Range parsing, `Content-Disposition`, MIME safety, chunk size constants).
- `src/services/videos/stream.js` — Telegram-to-HTTP streaming logic that ties `telegram-client` to Express response objects.
- `src/signedUrl.js` — `createSignedUrl`/`verifySignedUrl`: HMAC-SHA256 over `chatId:messageId:exp`, 1h TTL. Generated URLs point to `/api/v1/video/stream/...`.
- `src/login.js` — standalone script for the one-time interactive login described above.

### Auth: header vs signed query params

`requireToken` in `src/server.js` reads the token from `Authorization: Bearer <token>` by default — this covers every route. The only exceptions are `/api/v1/video/stream/:chatId/:messageId` and `/api/v1/video/dl/:chatId/:messageId`, which also accept signed, time-limited query params (`?exp=...&sig=...`, verified with `verifySignedUrl`). They are direct URL endpoints for VLC, browser `<video src>`, and downloads, where custom headers are often unavailable. They deliberately do **not** accept the raw master token in the query string. Discovery/write/cache routes require the header only; when handlers embed a ready-to-use video URL in JSON, they call `createSignedUrl(base, chatId, messageId)` rather than reflecting any token from the request.

**Dev auto-fill, fail-closed by design:** if `config.isDev` (`NODE_ENV === "development"`, exact match — not just "truthy" or "not production") and the incoming request has no `Authorization` header, `requireToken` injects `Bearer <ACCESS_TOKEN>` automatically before checking it, so local testing doesn't require passing the header on every call. Any other `NODE_ENV` value, including unset, skips this and enforces the header strictly. This was a deliberate choice after considering the alternative (`isDev` defaulting to true unless `NODE_ENV=production`): defaulting to open is a common footgun if a real deployment forgets to set `NODE_ENV` — this codebase defaults to strict instead.

### Request input placement (mandatory)

Every endpoint must place input according to its HTTP role. Do not move inputs between path, query, and body merely to make routes look uniform.

- **Path params** identify the stable target resource or action target: `chatId`, `messageId`, and `jobId` belong in the path. Do not duplicate them in the body.
- **Query params** describe a `GET` representation: filtering, sorting, pagination, field selection, or bounded read options such as `thumbnail`. They must not perform a mutation. Do not put a body on a `GET` route: intermediaries and HTTP clients do not consistently support or cache it.
- **Request body** carries data that creates or changes state, or meaningful options for a non-GET command. Use JSON by default; use `multipart/form-data` when files are sent. For example, upload `file`, `thumbnail`, `description`, and `filename` are multipart body fields, while an edited `description` is a JSON body field.
- **Headers** carry transport/authentication concerns, including `Authorization` and `Range`; never put the master access token in a query string.

The only approved query-string exception is `exp`/`sig` on direct `GET` stream/download URLs. These routes must remain usable by VLC, browsers, `<video src>`, and download links, which cannot reliably send a body or custom authorization header. The signature must remain scoped and time-limited; do not replace it with the master token.

If a read filter itself is sensitive enough that it must not appear in browser history, access logs, or shared URLs, add a **new, explicitly documented `POST` search endpoint** with a JSON body. Preserve the existing `GET` listing endpoint and its query contract unless the user explicitly authorizes a breaking API version/change. Do not introduce such a search endpoint speculatively.

For every route change, update its Zod parser, integration tests, `docs/ROUTES.md`, and the matching Insomnia request in the same change. Tests must assert the intended location of each input (path/query/body), not only the resulting response.

### Request flow

1. Every request must include valid credentials (checked via constant-time comparison in `server.js`) — `Authorization: Bearer <ACCESS_TOKEN>` everywhere, or signed `?exp=...&sig=...` on stream/download only; requests without either get `401`.
2. `/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`, `/api/v1/channels`, and `/api/v1/channel/:channel_id` are discovery/detail endpoints that return JSON. Video listings include ready-to-use `/api/v1/video/stream/...` URLs with signed, expiring query params.
3. `/api/v1/video/stream/:chatId/:messageId` streams inline when safe; `/api/v1/video/dl/:chatId/:messageId` forces download. Both honor `Range` and pull bytes lazily via TeleProto's media scheduler, without buffering the full file or writing it to disk.

### Caching and fetch concurrency

Every read function exported by `src/telegram-client.js` (`listChannels`, `getChannelInfo`, `listVideos`, `getChannelVideos`, `listAllVideos`, `getVideoMessage`) is wrapped with `withCache` from `src/cache/ttl-cache.js`: the function's actual body lives in a `*Uncached` variant, and the exported name is `withCache(config.cacheTtlMs, keyFn, fooUncached)`. The cache is in-memory, keyed per function, and dedupes concurrent identical requests. Repeated requests to `/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`, `/api/v1/channels`, and `/api/v1/channel/:channel_id` come back near-instant within the TTL window (`CACHE_TTL_MS`), at the cost of listings/details being up to that long out of date after a Telegram-side change.

`getVideoMessage` (used by stream/download to resolve `chatId:messageId` → document/size/mimeType/fileName) is cached the same way, keyed by `` `${chatId}:${messageId}` ``. The actual byte transfer (`client._media.getFile` in `src/services/videos/telegram-range.ts`) is **never** cached — only the metadata lookup is.

`listAllVideos` additionally fetches chats in parallel (bounded by `TELEGRAM_FETCH_CONCURRENCY`, via `p-limit`) instead of the previous one-chat-at-a-time loop. `p-limit` is pinned to `3.1.0` — versions 4+ are ESM-only and break this CommonJS project.

**Adding a new read function that should be cached**: don't hand-roll `getOrSet` calls — write the function body as `*Uncached`, then export `withCache(config.cacheTtlMs, keyFn, fooUncached)`, matching the existing read exports. This is what makes the caching "global": any new route that reuses an existing `telegram-client.js` function inherits caching automatically; a genuinely new fetch only needs this one extra line.

**Manual purge**: `POST /api/v1/cache/purge` (`src/routes/cache/purge/route.ts`) calls `clearAllCaches()` from `src/utils/ttl-cache.js`, which clears every cache's `store`/`pending` maps. A new cached function automatically becomes purge-able the moment it's wrapped in `createTtlCache`/`withCache`.

### Native video filtering and pagination

`listVideos` (used by `/api/v1/videos/by/:chatId`) and `fetchDialogVideos`/`listAllVideos`'s per-chat fetch (used by `/api/v1/videos/grouped`) call `tg.getMessages(chatId, { filter: new Api.InputMessagesFilterVideo(), limit, addOffset })` instead of fetching raw messages and locally guessing which ones are videos. `Api.InputMessagesFilterVideo` is a Telegram server-side filter — it excludes video notes and GIFs and returns a `TotalList` whose `.total` is the real count of matching videos in that chat, not an estimate.

`/api/v1/videos/by/:chatId` uses this for **true native pagination** when `file_name` and `description` are absent: `addOffset = (page - 1) * per_page`, `limit = per_page`. With `file_name` or `description`, the route fetches up to `limit`, filters in memory, and then paginates so matches outside a single native page are not missed.

`/api/v1/videos/grouped` (aggregated across every dialog) **cannot** do this — there's no single Telegram call that paginates "all videos across all chats" with one cursor. It still fetches up to `limit` videos **per chat** this way (parallel, cached, same as before) — `limit` here is *not* a total cap on the response, it's the `limit` sent to each per-chat native call, so `?limit=1` with 26 chats that have videos returns 26 items (one per chat), not one. When `page`/`per_page` are supplied the cut is done in memory over the already-aggregated-and-filtered array (`paginate()` in `src/utils/pagination.ts`) — this shrinks the response, not the number of Telegram calls.

`/api/v1/channels` (the plain dialog list) also takes `limit` (default `100`), passed straight to `tg.getDialogs({ limit })` (`listChannelsUncached` in `src/telegram-client.ts`). Unlike the video filter, Telegram's dialog list has no server-side "channels only" filter, so `limit` caps **dialogs scanned in total** (channels + groups + DMs), not channels returned — `?limit=5` can return fewer than 5 channels if some of the 5 most recent dialogs aren't channels. Pagination on `/api/v1/channels` is the same in-memory `paginate()` as `/api/v1/videos/grouped`, applied after that scan-and-filter step.

**Response shape, `limit` vs `page`/`per_page`**: all four listing routes accept `limit` (default `100` — how much is fetched/considered, semantics vary by route as described above) and `page`/`per_page` (`per_page` capped at `100` — how the response is sliced). Omitting both `page` and `per_page` returns a flat array/object exactly like before this feature existed (respecting `limit`) — pagination mode, with the `{ data, page, per_page, total, total_pages }` envelope, only activates when at least one of `page`/`per_page` is present (`src/utils/pagination.ts`: `isPaginationRequested`/`resolvePagination`/`buildPageEnvelope`). `limit` isn't just for flat mode: `resolvePagination(query, defaultPerPage)` takes the route's `limit` as `defaultPerPage`, so passing only `page` (no `per_page`) still honors `limit` as the page size instead of silently falling back to a hardcoded `20` — `per_page`, when explicitly given, always wins over `limit`. Signed URLs (`createSignedUrl`) are only generated for the items actually in the response, never for a full unpaginated list when a page was requested.

### Text filtering (fuzzy, accent/case-insensitive)

`src/utils/text-search.ts` exports `normalizeForSearch` (NFD-normalize, strip diacritics, lowercase, trim) and `includesSearchTerm` (normalizes both sides, then `includes`) — this is the one substring-match implementation every route-level filter is built on; don't reimplement normalization elsewhere.

`/api/v1/videos/grouped` filters on `chat_id` (exact match, digits-only comparison via `extractDigits` in `src/services/videos/filters.ts`), `chat_title`, `file_name`, and `description`. `/api/v1/videos/by/:chatId` filters on `file_name` and `description`, via `filterByVideoText`. `/api/v1/channels` filters on `channel_id` and `channel_title`. Multiple filters on the same route combine with AND.

**Fuzzy filtering forces in-memory mode on routes with native pagination**: `/api/v1/videos/by/:chatId` normally paginates natively. When `file_name` or `description` is present, it fetches the whole `limit`-bounded set (`offset: 0`), filters it, and only then paginates in memory (`paginate()`).

### Key implementation details worth knowing before changing streaming/auth code

- Chunking uses a fixed `CHUNK_SIZE` of 512KB (`src/utils/http-response.js`).
- MediaScheduler streaming must pass `offset` as a `big-integer` instance (the `big-integer` package), not native `BigInt`. The helper aligns Telegram fetches to `CHUNK_SIZE` and slices/writes defensively so the HTTP body never exceeds the declared `Content-Length`.
- Client disconnect is tracked (`req.on("close")`) so an aborted download stops iterating instead of continuing to pull from Telegram after the response is gone.
- `chatId` in routes is passed straight to TeleProto (`getMessages`/`getEntity`); `"me"` is a TeleProto-recognized shortcut for Saved Messages.
- `Content-Disposition` filenames must be ASCII-safe or the HTTP header write throws (`Invalid character in header content`), which the route's catch block turns into a misleading generic `404`. `buildContentDisposition` in `src/utils/http-response.js` sends an ASCII-sanitized `filename=` fallback alongside a percent-encoded `filename*=UTF-8''...` (RFC 5987/6266) for the real name — needed because Telegram filenames routinely contain CJK text, emoji, etc.

### JSON field naming convention

All JSON response fields across every route use `snake_case`, lowercase (e.g. `chat_id`, `message_id`, `file_name`, `mime_type`). This applies to `/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`, `/api/v1/channels`, upload/update/delete responses, and any new route. Internal JS variables can stay camelCase when they are not serialized directly.

**`chat_id`/`chat_title` vs `channel_id`/`channel_title`**: Telegram's own MTProto schema (what TeleProto/this project talks to) has `Chat` and `Channel` as genuinely distinct peer types — `Channel` covers both broadcast channels and supergroups (`dialog.isChannel` in TeleProto), `Chat` is a basic group. A field identifying or naming a Telegram peer is never bare `id`/`title` — but which prefix to use depends on whether the route can *only* ever return channels:

- `/api/v1/channels` deals exclusively with peers where `dialog.isChannel` is true, so its response uses `channel_id`/`channel_title`.
- `/api/v1/channel/:channel_id` resolves exactly one Telegram `Channel`/supergroup and returns `channel_id`/`channel_title`, plus `description` from `channels.getFullChannel().fullChat.about`.
- `/api/v1/videos/grouped` can return any dialog type and uses `chat_id`/`chat_title`.
- `/api/v1/videos/by/:chatId` accepts any peer id, username, or `"me"` and uses `chat_id` in the response envelope, not `channel_id`.

No exceptions to either rule, regardless of whether the response object also carries video-level fields (`message_id`, `file_name`, etc.) at the same level.

### `limit`/`page`/`per_page` are mandatory for Telegram-backed routes

Any new route that fetches and returns data from the Telegram API (listings, searches, anything that reads a set of items) **must** accept `limit`, `page`, and `per_page`, reusing `src/utils/pagination.ts` (`paginationQuerySchema`, `isPaginationRequested`, `resolvePagination`, `paginate`/`buildPageEnvelope`) and the `limit`-as-`per_page` fallback already used by `/api/v1/videos/grouped`, `/api/v1/videos/by/:chatId`, and `/api/v1/channels`.

**If a route genuinely doesn't fit** (e.g. it always returns exactly one item, or isn't a listing at all): do not decide this on your own and skip the params silently. Stop and ask the user to explicitly confirm the exception before implementing without them. Only after approval, document the exception and the reasoning where the route itself is documented.

### Documenting new routes

Every route lives in a `route.ts` under `src/routes/`, following the public path segments after `/api/v1` as closely as possible. Every route added must get an entry in **`docs/ROUTES.md`** with purpose, accepted query params, and whether it is Privada or Híbrida. `README.md` intentionally stays high-level (setup, auth model, and a short route index linking to `docs/ROUTES.md`) — don't re-add per-route JSON examples there.

**Keep `docs/insomnia/Insomnia.yaml` in sync with `docs/ROUTES.md`**: any change to `docs/ROUTES.md` (a new route, or an edit to an existing route's purpose, query params, access level, or response shape) must be mirrored the same session in the matching request inside `docs/insomnia/Insomnia.yaml` — its per-request `description` fields (and query-param `description`s) are a mirror of `docs/ROUTES.md`, not an independent source of truth. A new route also needs a new request added to the `collection` array (same pattern as the existing requests: `url`, `name`, `meta`, `method`, `parameters` with `disabled: true` placeholders, `settings`). Never let the two docs drift — `docs/ROUTES.md` is authoritative; the Insomnia file is a derived, importable copy of the same content.

### Doc file naming convention

Files whose purpose is to document something (e.g. `docs/ROUTES.md`) use `SNAKE_CASE` + uppercase. This does **not** apply to root files whose exact name/casing is mandated by external tooling — `README.md` (GitHub/npm convention), `CLAUDE.md` (loaded by Claude Code specifically), `AGENTS.md` (read by other agent tooling) keep their conventional names as-is. When adding a new doc file under `docs/`, name it accordingly (e.g. `docs/DEPLOYMENT.md`, not `docs/deployment.md` or `docs/deploy-notes.md`).

### Directory naming convention

All directories in this project use `kebab-case`, lowercase — no `PascalCase`, `camelCase`, or `snake_case` (e.g. `src`, `src/routes`, `src/types`, `docs`). This applies to any new folder added under `src/` or elsewhere in the repo. This is about folder names only — file naming has its own conventions above (`JSON field naming convention`, `Doc file naming convention`).

### Directory structure and layer rules

Every file under `src/` belongs to exactly one of three layers, determined by what it depends on:

**`src/routes/`** — Route handlers only. Each endpoint is a single `route.ts` file mirroring the URL path after `/api/v1`. Its job is parsing the request (query, params, body), calling into `services/`, and returning the response. No business logic, no direct Telegram calls, no shared implementation — if you need code that two routes could reuse, it must go in `services/` or `utils/`.

**`src/services/`** — Domain business logic, organized by subdomain (e.g. `videos/`, `upload-progress-store.ts`). A service may import from `config`, `telegram-client`, `utils/`, and external packages. If a module coordinates between multiple subsystems or encapsulates a business rule (ffprobe, thumbnail resolution, Telegram streaming), it belongs here.

**`src/utils/`** — Pure, generic utilities with no imports from project modules (only stdlib or external packages). No side effects beyond their parameters. Examples: HTTP header parsing (`http-response.ts`), pagination helpers (`pagination.ts`), TTL cache data structure (`ttl-cache.ts`), text search (`text-search.ts`).

**Rule of thumb when adding a new file**: if it imports anything from `src/` (besides `utils/` itself), it goes in `services/`. If it imports nothing from `src/`, it goes in `utils/`. If it's a request handler, it goes in `routes/` as a `route.ts`.

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
