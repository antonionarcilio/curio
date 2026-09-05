---
name: testing
description: >
  Testing conventions for this repo (unit / int / e2e layers, teleproto mocking,
  fixtures, coverage). Use this skill when: (1) writing or changing any test file,
  (2) adding coverage for a new route or service, (3) working under test/e2e/,
  (4) setting up or debugging jest mocks of teleproto or @/telegram-client,
  (5) before running the test suite or interpreting a coverage report.
license: MIT
compatibility: Works with Claude Code. Assumes pnpm, jest, ts-jest, supertest.
metadata:
  author: api-tg-cdn
  version: "0.1.0"
allowed-tools: Read Write Edit Glob Grep Bash
---

# Testing conventions

TDD is the standard here: for any feature or bugfix, write a failing test first
(unit for pure/near-pure logic, supertest for route/middleware behavior), watch
it fail, implement the minimal change, then refactor green. There is no CI gate
beyond the local pre-commit hook.

## The three layers

The filename suffix, not the directory, is what `jest.config.js` `testMatch`
keys on. Mirror `src/` structure inside each layer
(`test/unit/utils/pagination.unit.test.ts` ↔ `src/utils/pagination.ts`).

| Layer | Files | Exercises | Telegram |
|---|---|---|---|
| unit | `test/unit/**/*.unit.test.ts` | one module in isolation, no HTTP | `teleproto` package mocked; or the module is pure |
| int | `test/int/**/*.int.test.ts` | real Express sub-router + middleware via `supertest` | `@/telegram-client` mocked at the module boundary |
| e2e | `test/e2e/**/*.e2e.test.ts` | the full app against the real Telegram account | nothing mocked — opt-in / manual only |

### Commands

- `npx pnpm test` — unit + int (this is what the pre-commit hook runs)
- `npx pnpm test:unit` / `npx pnpm test:int` — one layer (plain path filter)
- `npx pnpm test:e2e` — separate config, manual only (see e2e section)
- `npx pnpm test:coverage` — unit + int with a coverage report
- `npx pnpm test:watch` — watch mode (unit + int)

### Shared setup

- `test/setup-env.ts` runs before every unit/int file (`setupFiles`) and injects
  fake `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `ACCESS_TOKEN` / `PORT` so
  `src/config.ts` never throws and no real `.env` is touched. **`test/e2e/`
  deliberately does not load it.**
- Tests run under `ts-jest` against `tsconfig.jest.json` (a copy of
  `tsconfig.json` with `rootDir` / `include` widened to cover `test/`).
- Aliases `@/*` and `@test/*` resolve via `moduleNameMapper` in
  `jest.config.js` / `jest.e2e.config.js` (ts-jest does not read `tsconfig`
  `paths` on its own).

## Unit layer

Pure modules (`src/utils/*`, pagination, text-search, signed-url, the
`create-*` factories) test directly with no mocks.

For `test/unit/telegram-client.unit.test.ts`, mock the low-level package:

```ts
jest.mock('teleproto');
jest.mock('teleproto/sessions');
```

Stub the `TelegramClient` methods the code calls (`connect`, `getMessages`,
`getDialogs`, `getEntity`, `getMe`, `uploadFile`, `sendFile`, `downloadMedia`)
and `Api.InputMessagesFilterVideo` / `Api.InputMessagesFilterMusic` directly.

`src/utils/ttl-cache.ts` keeps its cache registry at module scope, so call
`clearAllCaches()` (from `@/utils/ttl-cache`) in `beforeEach` — otherwise one
test's mocked `getMessages` / `getDialogs` call count leaks into the next. Jest
gives each *test file* a fresh module registry, so this only matters within a
single file.

Pure-function describes for `src/server.ts` (`timingSafeEqualStrings`,
`extractBearerToken`, `verifySignedStream`) live in
`test/unit/server.unit.test.ts` — no mocking, no HTTP round trip.

## Int layer

Standard shape — mock `@/telegram-client`, mount the sub-router with
`mountRouter`:

```ts
const mockListAllVideos = jest.fn();
jest.mock('@/telegram-client', () => ({ listAllVideos: mockListAllVideos }));

import someRouter from '@/routes/videos/grouped/route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter(someRouter);
```

- Use `mountRouter(router, { json: true })` for routes that read a JSON body.
- Never hand-roll `express()` + `app.use(...)` per file.
- `jest.clearAllMocks()` in `beforeEach` (`jest.config.js` also sets
  `clearMocks` / `restoreMocks`, but keep the explicit call for readability).
- Int mounts the **bare sub-router — no `requireToken`** — so int does not cover
  auth. Full-app auth wiring is covered in `test/int/server.int.test.ts` (which
  `jest.resetModules()` + re-requires `@/server` inside an isolated `describe` to
  exercise the dev auto-fill path, since `config.isDev` is computed once per
  module load) and end-to-end in `test/e2e/`.
- Assert the **input location** (path vs query vs body), the status code, the
  JSON shape, and error passthrough (a rejected service call surfaces as
  `500 { error: <message> }`).
- Streaming offset tests must assert `client._media.getFile` receives the
  document's `dcId`, a `big-integer` aligned offset, and `CHUNK_SIZE` as the
  Telegram request size — this guards the seekable HTTP Range contract.

`src/server.ts` exports `buildApp()` (synchronous Express factory, no I/O)
alongside `startServer()` (the real `ensureConnected()` + `app.listen()` path).
`startServer()` only runs under the `require.main === module` guard, so importing
`@/server` in a test never connects or binds a port.

## e2e layer

The mocked layers protect business logic but cannot catch **contract drift** —
if `teleproto` changes its API shape, every mock still passes while the app
breaks. `test/e2e/` catches that.

**It is opt-in and manual only.** `npx pnpm test:e2e`. Never wire it into
`pnpm test`, the pre-commit hook, or any CI-equivalent — it connects to the real
account in `.env` and needs live network. Run it by hand after upgrading
`teleproto`, or periodically as a sanity check.

### Separate config: `jest.e2e.config.js`

- **No `setupFiles`** — loading `test/setup-env.ts`'s fake credentials would
  authenticate against a nonexistent account.
- `maxWorkers: 1` — the tests share one real account; parallel runs trigger
  `FLOOD_WAIT`. **Never run two `test:e2e` invocations at once** for the same
  reason.
- `testTimeout: 1_200_000` — covers the large fixture's upload time.
- `forceExit: true` — TeleProto schedules disconnect-confirmation timers that
  fire a second or two after `client.destroy()` resolves.

The rationale for each flag is in the file's own comments.

### Structure rules

- **One file per route.** Driven **entirely through HTTP** — `supertest` +
  `buildApp()` via `test/e2e/helpers/http-client.ts`, which exports `app` and
  `authed(req)` (sets `Authorization: Bearer <ACCESS_TOKEN>` from the real
  `config`). Every call: `authed(request(app).get(...))`. This is the same path
  a real client hits, so it also catches Express-wiring bugs (query parsing,
  status codes, `requireToken`) that int cannot.
- **Every file is independent and self-contained.** It creates its own fixture
  in `beforeAll` (via `POST /api/v1/{video,audio}/upload/:chatId`), runs its
  assertions, and destroys it in `afterAll`. No dependency on execution order;
  there is no `testSequencer`.
- **Never use a service function for fixture setup or teardown.** Two narrow
  exceptions:
  1. **Lifecycle only** — `ensureConnected()` in `beforeAll` and
     `client.destroy()` in a file-level `afterAll` are allowed (they connect /
     shut down the client, they don't build a fixture).
  2. **`removeFixture`** (`test/e2e/helpers/video-fixture.ts` / audio
     equivalent) — used only by `delete-video.e2e.test.ts` /
     `delete-audio.e2e.test.ts` cleanup, because those files test the delete
     route itself; cleaning up through that route would fail for the same reason
     the test would, leaving a real orphaned message on the account.
  Every other file's cleanup uses `deleteFixtureViaApi` (HTTP-based).
- **`client.destroy()`, not `client.disconnect()`** — `disconnect()` leaves
  TeleProto's update loop / timers alive. Register it **once, outside any
  `describe.each`**, so it runs after all targets — per-target would leave the
  shared `TelegramClient` singleton's `connected` flag stuck `true` and break the
  next target's `ensureConnected()`.

### Helpers (`test/e2e/helpers/`)

| Helper | Exports |
|---|---|
| `http-client.ts` | `app` (one `buildApp()`), `authed(req)` |
| `upload-fixture.ts` | `uploadTestFixture(chatId, filePath, opts?)`, `pollUploadJobUntilSettled(jobId)` |
| `upload-audio-fixture.ts` | audio equivalents |
| `video-fixture.ts` | `TARGETS`, description constants, fixture path constants, `removeFixture`, `deleteFixtureViaApi`, `buildSmallThumbnailBuffer()` |
| `audio-fixture.ts` | audio description constants, re-exports `TARGETS` |

Upload is async: `POST` returns `202` + `job_id`, the send to Telegram runs in
the background. Every file that creates a fixture polls
`GET /api/v1/{video,audio}/upload/progress/:jobId` until the job leaves
`queued` / `uploading` — `uploadTestFixture` centralizes this.

### Targets

`describe.each(TARGETS)` runs each file against both Saved Messages (`"me"`) and
the test channel (`SMOKE_TEST_CHANNEL_ID`, which must keep its `-100` prefix).
`list-channels.e2e.test.ts` and `channel-detail.e2e.test.ts` query metadata that
already exists and create no fixture.

### Fixtures (`src/_assets/sample/`, Git LFS)

Run `git lfs install` once per machine; `git lfs pull` if a checkout leaves
these as pointer text files.

| File | Size | Used by |
|---|---|---|
| `15158346_3840_2160_60fps.mp4` | ~169 MB, 4K | `upload-video`, `stream-video`, `download-video` only — large enough to exercise many real `CHUNK_SIZE` iterations |
| `file_example_MP4_1920_18MG.mp4` | ~17 MB | every other video file that needs a fixture, plus the queue-control files |
| `sample-audio.mp3` | ~40 KB | the audio e2e files |
| `file_example_JPG_1MB.jpg` | ~1 MB | thumbnail source — `buildSmallThumbnailBuffer()` resizes it to ≤320×320 via `sharp` before attaching (Telegram rejects the raw 3800×2534 file) |

`stream` / `download` e2e mostly assert a small byte-exact Range slice
(`bytes=0-65535`) against the same slice read from the local file; the one full
unranged download runs once, only against `"me"`. Both also get a
signed-URL-without-`Authorization` check and a tampered-signature-401 check.

### Queue-control files

`cancel` / `pause` / `resume` / `pause-all` / `resume-all` (video and audio) each
get their own self-contained file. They test concurrent-job behavior, which
structurally needs each file to create its own in-flight upload to occupy the
single `UPLOAD_CONCURRENCY_LIMIT` slot before acting on a job queued behind it. A
job that only goes `queued`→`cancelled` or `queued`→`paused` never calls the
real upload (the scheduler discards it) — nothing to clean up. Each `afterAll`
calls `deleteFixtureViaApi` only for jobs that completed a real upload, in
`try/catch` per item.

## Coverage

Keep overall coverage **≥90%** on lines, branches, functions, and statements.
Verify with `npx pnpm test:coverage` before considering any feature or refactor
done; if it drops below 90%, add tests before finishing.

This is a **convention, not an enforced gate** — `jest.config.js` has no
`coverageThreshold` and the pre-commit hook does not check coverage. Do not
describe it as enforced. Test files, config, and build output are outside the
expectation (only `src/` counts).

## Ground rules

- ALWAYS write the failing test first, then the minimal implementation.
- ALWAYS use `mountRouter` (int) / `buildApp()` (e2e); NEVER hand-roll `express()`.
- NEVER call real TeleProto outside `test/e2e/`.
- NEVER wire `test:e2e` into `pnpm test`, the pre-commit hook, or CI.
- NEVER run two `test:e2e` invocations concurrently.
- In e2e, NEVER use a service function for fixture setup/teardown — HTTP only.
  Lifecycle `ensureConnected()` / `client.destroy()` and `removeFixture` (delete
  files only) are the sole exceptions.
- ALWAYS call `client.destroy()` (not `disconnect()`) once per e2e file, in a
  top-level `afterAll`.
- ALWAYS run `npx pnpm test:coverage` after test work and confirm ≥90%.
- PREFER extending an existing `test/int/routes/*.int.test.ts` pattern over
  inventing a new harness.
