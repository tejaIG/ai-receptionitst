# Repository guidelines

Palakarimpu AI is an open-source AI receptionist for small businesses. It answers phone calls and website chat, books appointments, takes messages, and transfers to a person when needed. This is a pnpm monorepo (Node >=26, pnpm 10) in TypeScript ESM.

## Architecture

Two long-running runtimes share one PostgreSQL database (enforced by row-level security, RLS) and a Redis/BullMQ queue:

- **Admin** (`apps/admin`, Next.js) serves the operator dashboard, authentication (Better Auth), the HTTP API, provider webhooks (Twilio, Polar, Resend), and the embeddable widget: API at `/api/widget/*`, loader at `/embed.js`, iframe app at `/embed/[key]`. It starts each call and asks the worker to attach at `/internal/live/attach` (`WORKER_INTERNAL_URL`, authenticated with `INTERNAL_SERVICE_SECRET`).
- **Worker** (`apps/worker`) runs asynchronous jobs, dispatches the transactional outbox, and runs live calls. It keeps a sideband WebSocket to each GPT-Live session, answers delegated requests, saves transcripts, and finishes the call.
- **Landing** (`apps/landing`) is the public marketing site, built with Astro. The Next.js notes below don't apply to it.

### Calls and chat share one agent

GPT-Live (OpenAI-hosted audio) talks with the caller. Phones reach it through a Twilio Elastic SIP trunk and browsers over WebRTC. It answers common questions from a business snapshot taken at call start and delegates anything that needs live data to the worker. The worker runs the receptionist agent in `packages/agent-core` (an AI SDK `ToolLoopAgent`) and returns short, fact-only results. Website chat runs the same agent on the `web_chat` channel, keyed on `widget_visitor_id` (no phone number needed).

Call behavior lives in `packages/agent-core/src/instructions.ts` (`buildLiveInstructions`) and `packages/agent-core/src/live/callController.ts`. For the greeting, goodbye, and silence-timeout logic, read `docs/voice/runtime.md`.

### Transactional outbox

Work that must follow a database write is written as an outbox row in the same transaction as the change. The worker then publishes it as a job (`packages/jobs`). Don't enqueue jobs directly from request handlers.

### Packages

- `packages/db`: Drizzle schema, PostgreSQL migrations, role-specific clients, RLS helpers. Admin and worker connect as different least-privilege roles through the `LOBBYSTACK_*_DATABASE_URL` variables.
- `packages/domain`: durable business logic shared by admin and worker.
- `packages/agent-core`: the receptionist agent, its tools, the GPT-Live session config, and the call controller.
- `packages/providers`: adapters for Twilio, embeddings, calendars, and email.
- `packages/embed`: Vite bundle that builds the widget loader (`dist/embed.js`). `scripts/copy-widget-embed.mjs` copies it into `apps/admin/public/embed/`.
- `packages/contracts`, `shared`, `jobs`, `telemetry`, `web-voice`: shared types, utilities, job definitions, OpenTelemetry, and browser voice.
- `docker/`, `docker-compose.yml`, `scripts/`: local infrastructure, operations, and certification tooling.

### AI configuration

- Text AI goes through the agent core and is set with `AI_CHAT_*`: `API_KEY`, `BASE_URL`, `MODEL`, `PROVIDER_NAME`, `REASONING_EFFORT`. The key falls back to `OPENAI_API_KEY`.
- On OpenAI the default is `gpt-6-luna` on high reasoning through the Responses API. Other OpenAI-compatible endpoints use chat completions.
- GPT-Live delegation runs on low reasoning. Change it with `AI_DELEGATION_MODEL` and `AI_DELEGATION_REASONING_EFFORT`.
- `AI_EMBEDDING_*` configures embeddings.

## Development commands

```bash
pnpm install
docker compose up -d postgres redis    # add --profile minio to test MinIO storage
cp .env.example .env                   # or: pnpm env:generate
pnpm db:migrate
pnpm dev                               # admin + worker + landing
pnpm dev:admin | pnpm dev:worker | pnpm dev:landing

pnpm typecheck                         # all workspaces and scripts/
pnpm lint
pnpm test                              # all Vitest suites
pnpm build                             # also copies the embed loader into the admin output
pnpm widget:embed:build                # rebuild only the widget loader
```

Browser calls need `LIVE_PROTOTYPE_ENABLED=true` and `OPENAI_API_KEY` on both admin and worker. Admin listens on `ADMIN_PORT` (default 3000).

Run one test file or test name from a workspace:

```bash
pnpm --filter @lobbystack/domain exec vitest run src/server/calendar.integration.test.ts
pnpm --filter @lobbystack/admin exec vitest run -t "test name"
```

Other checks:

- `pnpm test:reliability` runs the integration suites and needs `LOBBYSTACK_RELIABILITY_TEST_DATABASE_URL` set to a dedicated local test database.
- `pnpm db:check` and `VERIFY_RLS_BEHAVIOR=true pnpm db:verify-rls` verify migrations and RLS.
- `pnpm voice:eval` plays scripted callers against the real GPT-Live API. `pnpm voice:call` places real Twilio calls against staging. See `docs/voice/testing.md`.
- `pnpm replacement:*` scripts certify a running Compose stack. `docs/platform.md` lists them.

## Next.js MCP server

`.mcp.json` registers `next-devtools` (from `next-devtools-mcp`). It works only with `apps/admin`.

- Call `nextjs_docs` before you write Next.js code or answer a Next.js question, then read the guide it points to in `apps/admin/node_modules/next/dist/docs/`. Those docs match the installed version, so prefer them over memory or web results.
- Start the admin dev server with `pnpm dev:admin` or `pnpm dev`. Call `nextjs_index` to find it and list its tools, then `nextjs_call` to run one: `get_errors`, `get_routes`, `get_page_metadata`, `get_logs`, `get_compilation_issues`, `compile_route`. Pass `port` if the server isn't on 3000.
- Before you change admin pages, layouts, route handlers, or Server Actions, check `get_routes` and `get_errors`. Check `get_errors` again after the change.
- `get_errors` doesn't replace `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## Coding style

- Use 2-space indentation and LF line endings. `PascalCase` for React components, `camelCase` for functions and utilities.
- Keep durable business logic in `packages/domain` and persistence in `packages/db`.
- Add receptionist capabilities as agent-core tools backed by `packages/domain`, so website chat and calls share them.
- Keep voice personalization snapshot-based. Fetch a business snapshot at call start and avoid per-turn backend reads for common replies. Callers hear silence while the agent works, so keep tool results short.
- Don't import server-only code into browser bundles. `pnpm replacement:security` checks the admin boundary.
- Telemetry must not carry customer identifiers, credentials, prompts, transcripts, object keys, or signed URLs.

## Design system

- `shadcn/ui` is the default operator UI system in `apps/admin`.
- Use Geist Sans and Lucide icons. Don't mix icon families.
- Use the 4px spacing grid and the existing semantic color and radius tokens.
- Use `rounded-xl` for standard surfaces and controls, and `rounded-full` for pills, badges, avatars, and circular controls.
- In consistency cleanups, preserve colors, copy, logic, responsiveness, and route architecture.

## Localization

- Use translation keys for dashboard copy, with locale files at `apps/admin/public/locales/{lng}/{ns}.json`.
- Use interpolation instead of concatenating translated sentences.
- Format dates, times, and numbers for the active locale through `Intl` or Luxon.
- The interface languages are `en`, `fr`, `es`, and `sr`. Serbian is Latin script only. Pass any locale through `intlLocale()` from `@lobbystack/shared` before giving it to `Intl`, Luxon, `lang`, or `hreflang`, so `sr` becomes `sr-Latn`. A bare `sr` formats in Cyrillic.
- The AI receptionist speaks English and French only (`RuntimeLocale`). Keep business caller languages and voice prompts to those two.

## Testing

- Vitest is the test runner. Keep `*.test.ts` and `*.test.tsx` next to their source.
- Test database behavior against PostgreSQL with the correct runtime role and RLS context.
- Prioritize regressions in booking, authorization, webhooks, the outbox, snapshots, privacy, and telemetry.
- Every new telemetry event needs a test that asserts it fires from its real production code path.
- Before opening a PR, run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- When you change migrations or RLS, also run `pnpm db:check` and `pnpm db:verify-rls` against the test database.
- When you change GPT-Live instructions, the call controller, or how calls end, run `pnpm voice:eval` before opening the PR and `pnpm voice:call` against staging before merging. GPT-Live varies between runs, so run each scenario at least 3 times.

## Datastore

PostgreSQL is the canonical runtime datastore. `legacy_convex_id` columns hold IDs from the previous Convex platform. The Polar webhook business lookup, the finance export, and call and contact ID display still read them.
