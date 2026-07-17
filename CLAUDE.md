# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev           # Start dev server (Next.js Turbopack)
pnpm build         # Runs DB migration then Next.js build
pnpm check         # Lint with Biome/ultracite (read-only)
pnpm fix           # Auto-fix lint issues
pnpm test          # Run Playwright e2e tests
pnpm test:unit     # Run node:test unit tests via tsx (tests/unit/)
pnpm eval:scribe   # Live-model agent evals for the scribe flow via Evalite (tests/evals/scribe/)

pnpm db:migrate    # Apply pending SQL migrations
pnpm db:generate   # Generate migrations from schema changes (drizzle-kit)
pnpm db:studio     # Open Drizzle Studio GUI
```

## Architecture

**EMRgent AI** is a Next.js 16 App Router chatbot that connects to an OpenEMR instance as the AI's backend data source. It is forked from the Vercel AI Chatbot template and heavily customized.

### Route groups

- `app/(auth)/` — sign-in, register, guest auth, NextAuth API routes
- `app/(chat)/` — main chat UI, artifact editor, and all API routes

### Auth (`app/(auth)/auth.ts`)

Three NextAuth v5 providers:

1. **Credentials** — email/password against the local Postgres `User` table
2. **Guest** — anonymous sessions, creates a throwaway user row
3. **OpenEMR OIDC** — only registered when `OPENEMR_ISSUER`, `OPENEMR_CLIENT_ID`, and `OPENEMR_CLIENT_SECRET` are all set; uses PKCE + state (no nonce, OpenEMR doesn't echo it)

On OpenEMR sign-in the JWT callback upserts a local user and captures the OpenEMR OAuth2 tokens (`accessToken`, `refreshToken`, `expiresAt`) in the encrypted JWT. The jwt callback refreshes the access token when it's within 60 seconds of expiry. The session callback exposes a trimmed `session.openemr` object for server-side API calls.

### OpenEMR API (`lib/openemr/api.ts`)

`openemrFetch(path, params?, init?)` — server-only helper that reads the bearer token from the current session and calls `OPENEMR_API_BASE + path`. Throws `OpenEmrNotConnectedError` (session has no token) or `OpenEmrApiError` (non-2xx response). All AI tools catch these and return a structured error object rather than throwing, so the model can report them gracefully.

**Self-signed cert in dev**: `OPENEMR_ALLOW_SELF_SIGNED=true` disables TLS verification for the Node.js runtime. This is set in `instrumentation.ts` which runs once at server startup — changing it requires a **full server restart**, not just a hot reload.

**Client-side proxy routes** (`app/(chat)/api/openemr/`): client components can't call the server-only `openemrFetch`, so routes like `soap-note` (GET/PUT) and `facility` proxy the OpenEMR API as the signed-in user. They map errors to `401 not_connected_to_openemr` / `502 openemr_api_error` (plain bodies — not the `{code, cause}` shape the shared `fetcher` in `lib/utils` expects, so callers use a local fetcher). OpenEMR's `soap_note` endpoints are keyed by the legacy numeric `pid`, not the patient uuid; the soap-note GET accepts either (`puuid` gets resolved to a `pid` first).

### AI tools (`lib/ai/tools/`)

- `openemr.ts` — data tools: `searchPatients`, `getEncounters`, `getSoapNote`, `getAppointments`, `getMedicalProblems`, `getMedications`, `getSurgeries` (call the OpenEMR REST API). Successful outputs are wrapped as `{ sourceToolCallId, results }` — the stamp is the call's own `toolCallId`, included because providers don't reliably expose tool-call ids as model-visible text, and `generateUI` domain cards bind to results by that id (the model copies it from the result rather than recalling it)
- `generate-ui.ts` — `generateUI` (see Generative UI below). A **factory**, not a singleton: the route passes it a per-request `seenToolCalls` registry
- `get-weather.ts` — demo weather tool (gated behind the human-approval flow)
- `create-document.ts`, `edit-document.ts`, `update-document.ts`, `request-suggestions.ts` — artifact/document editing flow

Tools are registered in `app/(chat)/api/chat/route.ts`. Reasoning models (detected via the AI Gateway capabilities API) get an empty `activeTools` list.

### Generative UI (`lib/ai/a2ui/`, `components/chat/a2ui/`)

The model decides per response whether to render UI. Data tools return raw data the user cannot see and render only as collapsed name+params tool chrome in `components/chat/message.tsx`; to show data, the model calls `generateUI` with a declarative spec (an A2UI-inspired dialect — see the mapping comment in `lib/ai/a2ui/schema.ts`): a flat component list referencing children by id, plus an optional `dataModel` bound via JSON-pointer paths. The client renders the spec from **`part.input`** (the output only confirms validity).

Two binding tiers keep clinical data out of the LLM's hands:

- **Domain cards** (`PatientsCard`, `EncountersCard`, `AppointmentsCard`, `MedicalIssuesCard`, `SoapNoteCard`) bind to a prior data tool call via `sourceToolCallId`; the client resolves the referenced tool part from `A2UIToolSourceProvider` (indexes all messages, so cross-turn references work) and feeds the *actual* output to the existing bespoke card components. The model never transcribes record fields.
- **Generic primitives** (`Card`, `Row`, `Column`, `List`, `Text`, `Stat`, `Table`, `Badge`, `Divider`) take literals or `dataModel` paths — for model-derived values only (deltas, summaries).

**Adding a catalog component requires three co-located updates**: the zod union + `A2UI_CATALOG_PROMPT` in `lib/ai/a2ui/schema.ts`, and the registry in `components/chat/a2ui/registry.tsx`. Domain cards also need an entry in `DOMAIN_CARD_SOURCES` (schema.ts) mapping them to their allowed source tool part types.

Validation is two-layered and always fail-soft: server-side, `generateUI`'s execute checks structure (`validateSurface`) and that every `sourceToolCallId` is a real call — merging replayed `messages` with the route's live `seenToolCalls` registry (filled from `streamText`'s `onChunk`), because execute's `messages` option **excludes same-step sibling calls** and would otherwise falsely reject them. Errors return `{ error }` so the model retries; failed attempts render collapsed, not as red cards. Client-side, unresolvable references degrade to a "data unavailable" chip and the whole surface sits in an error boundary — a bad persisted spec must never take down the message list.

The system prompt half of this lives in `generativeUiPrompt` (`lib/ai/prompts.ts`), which embeds `A2UI_CATALOG_PROMPT`. Weather and document tools keep their bespoke rendering and are not part of the catalog.

### Artifacts (`artifacts/`)

Each artifact kind has a client definition in `artifacts/<kind>/client.tsx`, registered in `artifactDefinitions` in `components/chat/artifact.tsx` (which derives the `ArtifactKind` type). `text`/`code`/`sheet`/`image` persist versioned content to the `Document` table via `/api/document`; their AI generation handlers live in `lib/artifacts/server.ts`.

The `soap` kind is the exception: it edits a SOAP note that lives in OpenEMR, opened by clicking a SOAP note card in chat (`components/chat/soap-note.tsx`). It saves debounced edits through `PUT /api/openemr/soap-note`, has no `Document` rows or version history, and reports save state via artifact metadata (`saveState`). `DocumentArtifactKind` (= `ArtifactKind` minus `soap`) types all DB-facing paths — a new locally-persisted kind must also be added to the `Document.kind` enum in `lib/db/schema.ts`, the zod schema in `app/(chat)/api/document/route.ts`, and `lib/artifacts/server.ts`.

### Models (`lib/ai/models.ts`)

Models are accessed through the Vercel AI Gateway. Capabilities (tool support, vision, reasoning) are fetched live from the Gateway API and cached for 24 hours. `DEFAULT_CHAT_MODEL` is `moonshotai/kimi-k2.5`.

### Database (`lib/db/`)

Drizzle ORM with Postgres. Tables: `User`, `Chat`, `Message_v2`, `Vote_v2`, `Document`, `Suggestion`, `Stream`. `pnpm build` runs `lib/db/migrate.ts` automatically before the Next build.

### Styling

The visual design is a **medical authority aesthetic** — drawn from the visual culture of medical institutions, journal bindings, and physician reference materials. Not "health tech startup." Think British Medical Journal, not Headspace.

Tailwind CSS v4 with `@theme inline` in `app/globals.css`. Colors use oklch throughout.

**Palette:**

- Light mode: ecru background (`oklch(0.955 0.015 84)`), warm near-black text, antiqued gold primary (`oklch(0.52 0.13 72)`)
- Dark mode: deep navy background (`oklch(0.14 0.05 248)`), parchment text, lighter gold primary (`oklch(0.73 0.12 72)`)
- Warm/cool shadow variables match the mode — no pure-black shadows
- **Semantic accents** (defined per-mode in `globals.css`, exposed as Tailwind utilities via `@theme inline` — never use stock Tailwind hues like `emerald-500` in app UI): chart-tab taxonomy `problem` (madder crimson), `medication` (steel blue), `encounter` (indigo ink), `surgery` (terracotta), `appointment` (muted teal) — vitals carry `primary` gold; status tones `positive` (viridian), `attention` (ochre orange), `negative` (alert red). One variable per mode, so no `dark:` variants needed — use `text-positive`, `bg-problem/70`, `ring-positive/35`, etc.

**Typography:**

- `font-display` (Lora, loaded via `next/font/google` in `app/layout.tsx`) — used for headings and brand wordmarks; set at `font-bold tracking-[0.06em]`
- Small-caps on brand wordmarks ("EMRgent") via inline `style={{ fontVariant: "small-caps" }}` — Tailwind has no `font-variant` utility
- `font-mono` for labels, counts, status indicators, and UI chrome at `text-[10px] uppercase tracking-[0.08–0.14em]`
- Body copy in the system sans-serif (Geist)

**Atmosphere:**

- Prescription-paper diagonal-stripe watermark on `body` via `repeating-linear-gradient(-45deg, ...)` — opacity is very low, set via `--watermark-line` CSS variable

**Brand mark:** The ECG waveform SVG (`<polyline points="0,9 10,9 13,4 16,14 19,1 22,14 25,9 44,9" />`) is the shared `EcgIcon` component in `components/ecg-icon.tsx` (no `"use client"`, so server components can import it too; the `animated` prop draws a repeating trace over a dimmed baseline). The assistant message avatar uses it as a `bg-primary` gold badge.

### Components

- `components/ui/` — shadcn/ui primitives generated by the `shadcn` CLI. Do not hand-edit; regenerate with the CLI instead. Excluded from Biome linting because the CLI's output style conflicts with ultracite's rules.
- `components/ai-elements/` — stream rendering primitives copied from the upstream Vercel AI Chatbot template. Also excluded from Biome linting for the same reason.
- `components/chat/` — all app-specific UI: sidebar, messages, artifact panel, patients card, etc. This is where new UI work goes.

### Testing

- `tests/e2e/` — Playwright browser tests (`pnpm test`). **Playwright test files cannot import local modules** (any `import` of app code — even a sibling file in `tests/` — fails with `context.conditions?.includes is not a function` under the current Playwright/Node combo). Keep them pure browser tests against the dev server, which the config boots automatically.
- `tests/unit/` — logic tests on `node:test`, run with `pnpm test:unit` (tsx, which resolves the `@/` alias). Put anything that needs to import app code here.
- The Playwright run (`PLAYWRIGHT=True`) swaps in scripted mock models (`lib/ai/models.mock.ts`, wired via `lib/ai/providers.ts`). Trigger phrases in the last user message play a multi-step script — data tool call → `generateUI` → closing text: `/appointment/i` → `getAppointments`/AppointmentsCard, `/patient/i` → `searchPatients`/PatientsCard; anything else streams fixed text. The mock is stateless: each `doStream` re-derives its step from the tool-result messages after the last user message.
- In the same env, `openemrFetch` serves canned data from `lib/openemr/fixtures.ts` instead of requiring an OpenEMR session — covering both the AI data tools and the client proxy routes, so the patient-overview artifact works e2e. Names asserted in e2e tests are duplicated string literals (e2e files can't import app code) — keep `tests/e2e/generative-ui.test.ts` in sync with `fixtures.ts`. `getCapabilities()` also short-circuits (all curated models report `tools: true`), so test runs make no gateway calls.
- **Always run e2e tests via `pnpm test`, never `npx playwright test` directly** — `PLAYWRIGHT=True` is set by the package.json script, not the Playwright config. A direct `npx` run boots a server without the mocks, so the mock-dependent tests (`generative-ui.test.ts`) silently hit the real gateway model and fail on missing tool chips.
- `tests/evals/scribe/` — **live-model agent evals** for the scribe flow, run on **Evalite** (`pnpm eval:scribe`, costs real gateway tokens; `eval:scribe:watch` re-runs on change, `eval:scribe:ui` serves the results UI on localhost:3006 with score history and per-row scorer metadata). Sends dialogue-transcript kickoff messages to a live Kimi K2.5 agent running the production system prompt and the real OpenEMR tools against fixtures, then (a) deterministically checks the tool-call protocol (`checks.ts`) and (b) grades SOAP quality + documentation fidelity with LLM graders (`grader.ts`) — all as binary Evalite scorers (subscores/rationales/warnings live in scorer metadata), so the CLI's default threshold of 100 keeps all-must-pass exit codes. The env split that makes this possible: `useMockModels` vs `useOpenEmrFixtures` in `lib/constants.ts` — `OPENEMR_FIXTURES=true` (set unconditionally in `tests/evals/scribe/setup.ts`) serves fixture data while models stay live; `PLAYWRIGHT=True` implies both. The stateful created-encounter overlay is `AsyncLocalStorage`-scoped (`withFixtureState` in `lib/openemr/fixtures.ts`), so eval rows run concurrently without seeing each other's writes; code outside a scope (the Playwright dev server) shares the default store. The root `vitest.config.ts` (read only by evalite) aliases `server-only` to a stub and `@` to the repo root. Options via env vars: `SCRIBE_EVAL_CASE=<id>`, `SCRIBE_EVAL_TRIALS=<n>`, `SCRIBE_SKIP_GRADERS=true`; JSON export via `pnpm eval:scribe -- --outputPath=<path>`. Expect some live-model variance; failures show the tool-call trace column and grader rationales in the UI.
- **Kill any running dev server before `pnpm test`.** `reuseExistingServer: !process.env.CI` makes Playwright reuse a server already on port 3000, and one started via plain `pnpm dev` lacks `PLAYWRIGHT=True` — same silent real-model failure mode. Running on another port doesn't work around it: Next.js 16 refuses to boot a second dev server for the same project (exits 1, pointing at the existing PID). Symptom to recognize: the failure snapshot shows a real reasoning response ("Thought for N seconds", "sign in with OpenEMR first") instead of the scripted tool flow.

## Frontend Aesthetics

This app has a committed visual identity — the **medical authority aesthetic**. When adding new UI, work within it rather than importing a different design language.

**Avoid AI-generated defaults:**

- Generic fonts (Inter, Roboto, Arial, Space Grotesk, system-ui)
- Purple/violet gradients or accents
- `rounded-lg` on everything — this app uses `rounded-xl` for cards and `rounded-[5-6px]` for small badges
- Flat, colorless designs — the app uses depth (shadows, rings, translucent backgrounds) throughout

## Environment variables

See `.env.example` for the full list. Key ones:

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | NextAuth session encryption |
| `POSTGRES_URL` | Neon / Postgres connection string |
| `REDIS_URL` | Optional — enables resumable streams |
| `AI_GATEWAY_API_KEY` | Required for non-Vercel deployments |
| `OPENEMR_ISSUER` | OIDC issuer URL (e.g. `https://localhost:9300/oauth2/default`) |
| `OPENEMR_CLIENT_ID` | Registered OpenEMR OAuth2 client |
| `OPENEMR_CLIENT_SECRET` | |
| `OPENEMR_API_BASE` | REST API base (e.g. `https://localhost:9300/apis/default`) |
| `OPENEMR_ALLOW_SELF_SIGNED` | `true` to skip TLS verification in dev — requires server restart |

OpenEMR OIDC is silently skipped (no crash) when its three required env vars are absent, so local dev without an OpenEMR instance works fine.
