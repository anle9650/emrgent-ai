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

**EMRgent AI** is a Next.js 16 App Router chatbot that connects to an OpenEMR instance as the AI's backend data source. Forked from the Vercel AI Chatbot template.

### Route groups

- `app/(auth)/` — sign-in, register, guest auth, NextAuth API routes
- `app/(chat)/` — main chat UI, artifact editor, and all API routes

### Auth (`app/(auth)/auth.ts`)

Three NextAuth v5 providers:

1. **Credentials** — email/password against the local Postgres `User` table
2. **Guest** — anonymous sessions, creates a throwaway user row
3. **OpenEMR OIDC** — only registered when `OPENEMR_ISSUER`, `OPENEMR_CLIENT_ID`, and `OPENEMR_CLIENT_SECRET` are all set; PKCE + state (no nonce — OpenEMR doesn't echo it)

On OpenEMR sign-in the JWT callback upserts a local user and captures the OpenEMR OAuth2 tokens (`accessToken`, `refreshToken`, `expiresAt`) in the encrypted JWT, refreshing within 60s of expiry. The session callback exposes a trimmed `session.openemr` for server-side calls.

### OpenEMR API (`lib/openemr/`)

`api.ts`'s `openemrFetch(path, params?, init?)` — server-only helper that reads the bearer token from the session and calls `OPENEMR_API_BASE + path`. Throws `OpenEmrNotConnectedError` / `OpenEmrApiError`; AI tools catch both and return a structured error the model can report gracefully.

- `summaries.ts` — trims full OpenEMR records to token-light, PHI-minimal shapes (`PatientSummary`, `MedicalProblemSummary`, `LatestVitals`, ...), shared by the AI tools and the patient-overview route
- `availability.ts` — pure slot-derivation logic backing `selectAppointmentSlot`/`createAppointment` (quarter-hour grid, weekday rules, default office-visit category)
- `patient-overview.ts` — assembles the full chart-overview payload (demographics, vitals, problems, medications, upcoming appointments) for the `patient-overview` route/artifact
- `refresh.ts` — OpenEMR refresh-token exchange, hardened for token rotation: memoized by incoming refresh token, concurrent callers share one in-flight exchange
- `fixtures.ts` — canned data served instead of live calls under test (`resolveOpenEmrFixture`), plus the shared `FixtureState` overlay and its per-scope statefulness (see Demo mode / Testing)
- `demo-data.ts` — the richer ~8-patient `demoDataset` (each patient a consistent chart) plus a full current-day schedule regenerated on every read, served by demo mode

**Demo OpenEMR instance**: `OPENEMR_DEMO=true` serves a functional, consistent, per-user **stateful** mock OpenEMR to any session without an OpenEMR token — **guests included** — instead of the "connect to OpenEMR" flow, so the app (scribe flow and all) can be demoed with no real OpenEMR server. Gating lives in `openemrRequest` (`api.ts`): after `auth()` finds no token, if `useOpenEmrDemo` it resolves via `resolveDemoFixture(userId, ...)` rather than throwing `OpenEmrNotConnectedError`. State is a `Map<userId, FixtureState>` (keyed on `session.user.id`, guests have one), seeded lazily from `demoDataset`, in-memory (resets on restart), isolated per user. Reuses the same `resolveOpenEmrFixture` resolver as test/eval — mutually exclusive with `useOpenEmrFixtures` (test env wins). Writes persist through the overlay: encounters/SOAP/vitals/appointments **and** problem/medication/surgery creates + `update*` patches (applied over base rows on read via `applyIssuePatches`), so a booked appointment or a scribe session's chart edits actually stick. `demoDataset.getAppointments()` regenerates a full schedule for the current day on every call (≥ half `pc_apptstatus:"<"`), regardless of weekday. Statefulness is now a per-`FixtureState` flag (`withFixtureState` and demo stores are stateful; the shared default store stays stateless unless `OPENEMR_FIXTURES=true`, preserving eval behavior).

**Self-signed cert in dev**: `OPENEMR_ALLOW_SELF_SIGNED=true` disables TLS verification, set once in `instrumentation.ts` at server startup — changing it needs a **full restart**, not a hot reload.

**Client-side proxy routes** (`app/(chat)/api/openemr/`): `soap-note` (GET/PUT), `facility`, `patient-overview`, `available-appointments` proxy the OpenEMR API for client components, since they can't call the server-only `openemrFetch`. Errors map to `401 not_connected_to_openemr` / `502 openemr_api_error` as plain bodies (not the `{code, cause}` shape `lib/utils`'s `fetcher` expects — callers use a local fetcher). `soap_note` is keyed by legacy numeric `pid`; the GET also accepts `puuid`, resolved to a `pid` first.

### AI tools (`lib/ai/tools/`)

All in `openemr.ts` unless noted. Successful data-tool outputs wrap as `{ sourceToolCallId, results }` — the call's own `toolCallId`, included because providers don't reliably expose it as model-visible text; `generateUI` domain cards bind to results by that id (copied by the model rather than recalled).

- **Read** — `searchPatients`, `getEncounters` (with SOAP note + vitals), `getSoapNote`, `getAppointments`, `getNextAppointment` (next roomed patient today), `getMedicalProblems`, `getMedications`, `getSurgeries`.
- **Write** — `createEncounter`, `createMedicalProblem`/`updateMedicalProblem`, `createMedication`/`updateMedication`, `createSurgery`, `createAppointment`, `sendMessage` (plain-language visit-summary via the OpenEMR portal). Registered with AI SDK `toolApproval: "user-approval"` in `app/(chat)/api/chat/route.ts` — each runs only after the clinician approves its card; the model just calls them.
- **Interactive** — `select-appointment-slot.ts`'s `selectAppointmentSlot` renders an inline slot picker (from `lib/openemr/availability.ts`) and pauses the run until the clinician books or skips; call alone, then follow with `createAppointment` once resolved.
- `generate-ui.ts` — `generateUI` (see Generative UI). A **factory**, not a singleton: the route passes a per-request `seenToolCalls` registry.
- `get-weather.ts` — demo tool, also approval-gated.
- `create-document.ts`, `edit-document.ts`, `update-document.ts`, `request-suggestions.ts` — artifact/document editing.
- **MCP** — `lib/ai/mcp/merge.ts`'s `createMergeMcpTools()` connects to Merge Agent Handler over MCP (`@ai-sdk/mcp`) and exposes NPI Registry provider search (`search_individual_providers`). Enabled only when `MERGE_AGENT_HANDLER_API_KEY` + `MERGE_TOOL_PACK_ID` + `MERGE_REGISTERED_USER_ID` are all set (one shared Registered User — NPI data is public); skipped under `useMockModels` and on any connection error, so the chat still runs without it. The route spreads its tools into `tools`, appends the tool names to `activeTools`, and closes the MCP client in `streamText`'s `onFinish`/`onError`. Read-only, so not approval-gated. Results aren't a Generative-UI domain-card source, so they render as tool chrome unless the model summarizes them.

`stopWhen: isStepCount(16)` sizes the step budget for the scribe flow's worst case (history reads → create/update writes → `createEncounter` → `getEncounters` → `generateUI` → text); approvals reset the budget. Reasoning models get an empty `activeTools` list.

### Scribe sessions (`lib/ai/scribe.ts`, `components/chat/scribe/`, `scribePrompt`)

The app's defining feature: record a visit, and the agent turns the transcript into chart writes gated behind clinician approval.

- **Recording (client)** — `patient-select.tsx` picks the patient; `recording-panel.tsx` + `hooks/use-encounter-recorder.ts` capture ambient audio in ~10-minute rotated segments (independently decodable blobs, under Vercel's body limit and Whisper's file cap) and transcribe each; `use-scribe-session.tsx`/`use-scribe-mode.tsx` hold session/mode state. `lib/ai/scribe.ts`'s `buildScribeKickoffMessage` packs transcript + prior chart into one kickoff message, keyed on `SCRIBE_SESSION_HEADER`/`SCRIBE_TRANSCRIPT_MARKER`/`SCRIBE_PRIOR_CHART_MARKER` — load-bearing strings: `scribePrompt` reacts to them, `models.mock.ts` parses on them, message rendering collapses the transcript below the marker.
- **Charting (agent)** — `scribePrompt` (`lib/ai/prompts.ts`) works in ordered, single-purpose steps so nothing writes without sign-off: (1) `selectAppointmentSlot` for the follow-up first, then `createAppointment` once resolved; (2) all `update*` calls in one step; (3) all `create*` calls in one step; (4) one `createEncounter` (vitals only what was actually spoken); (5) `sendMessage` with the visit summary; (6) `generateUI` with a `ViewChartCard` bound to the encounter; (7) `getNextAppointment` for the next roomed patient; (8) a short closing summary. See `scribePrompt` for exact batching conditions.
- `hooks/use-scribe-chart-autorefresh.ts` revalidates the patient-overview SWR key if that chart is already open, once charted.
- Covered end-to-end by `tests/evals/scribe/` (see Testing).

### Generative UI (`lib/ai/a2ui/`, `components/chat/a2ui/`)

The model decides per response whether to render UI. Data tools return raw data the user can't see, rendering only as collapsed tool chrome (`components/chat/message.tsx`); to show data, the model calls `generateUI` with a declarative spec (A2UI-inspired — see the mapping comment in `lib/ai/a2ui/schema.ts`): a flat component list referencing children by id, plus an optional `dataModel` bound via JSON-pointer paths. The client renders from **`part.input`** (the output only confirms validity).

Two binding tiers keep clinical data out of the LLM's hands:

- **Domain cards** (`PatientsCard`, `EncountersCard`, `AppointmentsCard`, `MedicalIssuesCard`, `SoapNoteCard`) bind to a prior data tool call via `sourceToolCallId`; the client resolves it through `A2UIToolSourceProvider` (indexes all messages, so cross-turn references work) and feeds the actual output to the bespoke card components. `ViewChartCard` is the exception — an action card (opens the patient-overview artifact) sourced from `createEncounter`, not a read tool.
- **Generic primitives** (`Card`, `Row`, `Column`, `List`, `Text`, `Stat`, `Table`, `Badge`, `Divider`) take literals or `dataModel` paths, for model-derived values only (deltas, summaries).

**Adding a catalog component requires three co-located updates**: the zod union + `A2UI_CATALOG_PROMPT` in `lib/ai/a2ui/schema.ts`, and the registry in `components/chat/a2ui/registry.tsx`. Domain cards also need a `DOMAIN_CARD_SOURCES` entry (schema.ts) mapping to allowed source tool types.

Validation is two-layered and fail-soft. Server-side, `generateUI`'s execute checks structure (`validateSurface`) and that every `sourceToolCallId` is real — merging replayed `messages` with the route's live `seenToolCalls` registry, since execute's `messages` excludes same-step sibling calls. Errors return `{ error }` so the model retries; failed attempts render collapsed. Client-side, unresolvable references degrade to a "data unavailable" chip inside an error boundary — a bad persisted spec must never take down the message list.

The prompt half lives in `generativeUiPrompt` (`lib/ai/prompts.ts`), embedding `A2UI_CATALOG_PROMPT`. Weather and document tools keep bespoke rendering, outside the catalog.

### Artifacts (`artifacts/`)

Each kind has a client definition in `artifacts/<kind>/client.tsx`, registered in `artifactDefinitions` in `components/chat/artifact.tsx` (which derives `ArtifactKind`). `text`/`code`/`sheet`/`image` persist versioned content to `Document` via `/api/document`; generation handlers live in `lib/artifacts/server.ts`.

`soap` and `patient-overview` (`OPENEMR_ARTIFACT_KINDS`) read/edit live OpenEMR state instead — no `Document` rows or version history. `soap` edits a SOAP note opened from a chat card (`components/chat/soap-note.tsx`), saving debounced edits via `PUT /api/openemr/soap-note` and reporting state through metadata (`saveState`). `patient-overview` (opened via `ViewChartCard`) is read-only, fetching `lib/openemr/patient-overview.ts`'s payload and re-fetching on scribe autorefresh. `DocumentArtifactKind` (= `ArtifactKind` minus the OpenEMR kinds) types all DB-facing paths — a new locally-persisted kind also needs the `Document.kind` enum (`lib/db/schema.ts`), the zod schema (`app/(chat)/api/document/route.ts`), and `lib/artifacts/server.ts`.

### Models (`lib/ai/models.ts`)

Accessed through the Vercel AI Gateway. Capabilities (tools, vision, reasoning) are fetched live and cached 24h. `DEFAULT_CHAT_MODEL` is `moonshotai/kimi-k2.5`.

### Database (`lib/db/`)

Drizzle ORM + Postgres. Tables: `User`, `Chat`, `Message_v2`, `Vote_v2`, `Document`, `Suggestion`, `Stream`. `pnpm build` runs `lib/db/migrate.ts` before the Next build.

### Styling

Visual identity: **medical authority aesthetic** — medical institutions, journal bindings, physician reference materials. Think British Medical Journal, not Headspace.

Tailwind CSS v4 with `@theme inline` in `app/globals.css`. Colors in oklch throughout.

**Palette:**

- Light: ecru background (`oklch(0.955 0.015 84)`), warm near-black text, antiqued gold primary (`oklch(0.52 0.13 72)`)
- Dark: deep navy background (`oklch(0.14 0.05 248)`), parchment text, lighter gold primary (`oklch(0.73 0.12 72)`)
- Warm/cool shadow variables match the mode — no pure-black shadows
- **Semantic accents** (per-mode in `globals.css`, Tailwind utilities via `@theme inline` — never stock hues like `emerald-500`): `problem` (madder crimson), `medication` (steel blue), `encounter` (indigo ink), `surgery` (terracotta), `appointment` (muted teal), vitals use `primary` gold; status tones `positive` (viridian), `attention` (ochre orange), `negative` (alert red). One variable per mode, so no `dark:` variants — use `text-positive`, `bg-problem/70`, `ring-positive/35`, etc.

**Typography:**

- `font-display` (Lora, via `next/font/google`) for headings/wordmarks, `font-bold tracking-[0.06em]`
- Small-caps on brand wordmarks ("EMRgent") via inline `style={{ fontVariant: "small-caps" }}` — no Tailwind utility for it
- `font-mono` for labels/counts/status at `text-[10px] uppercase tracking-[0.08–0.14em]`
- Body copy in system sans-serif (Geist)

**Atmosphere:** prescription-paper diagonal-stripe watermark on `body` via `repeating-linear-gradient(-45deg, ...)`, opacity set via `--watermark-line`.

**Brand mark:** the ECG waveform SVG (`<polyline points="0,9 10,9 13,4 16,14 19,1 22,14 25,9 44,9" />`) is `EcgIcon` (`components/ecg-icon.tsx`, no `"use client"` so server components can import it; `animated` draws a repeating trace over a dimmed baseline). The assistant avatar uses it as a `bg-primary` gold badge.

### Components

- `components/ui/` — shadcn/ui primitives. Don't hand-edit; regenerate via the CLI. Excluded from Biome linting (CLI output conflicts with ultracite).
- `components/ai-elements/` — stream-rendering primitives copied from the upstream template. Also excluded from linting.
- `components/chat/` — app-specific UI (sidebar, messages, artifact panel, cards). New UI work goes here.

### Testing

- `tests/e2e/` — Playwright browser tests (`pnpm test`). **Test files can't import local modules** — any `import` of app code fails with `context.conditions?.includes is not a function` on this Playwright/Node combo. Keep them pure browser tests against the auto-booted dev server.
- `tests/unit/` — `node:test` logic tests via `pnpm test:unit` (tsx resolves the `@/` alias). Put anything importing app code here.
- Playwright runs (`PLAYWRIGHT=True`) swap in scripted mock models (`lib/ai/models.mock.ts`, wired via `lib/ai/providers.ts`). Trigger phrases in the last user message drive a multi-step script — tool call → `generateUI` → closing text: `/appointment/i` → `getAppointments`/AppointmentsCard, `/patient/i` → `searchPatients`/PatientsCard; anything else streams fixed text. Stateless — each `doStream` re-derives its step from tool-result messages after the last user message.
- Same env: `openemrFetch` serves canned data from `lib/openemr/fixtures.ts` instead of a real session, covering both AI tools and client proxy routes. Names asserted in e2e tests are duplicated string literals (can't import app code) — keep `tests/e2e/generative-ui.test.ts` in sync with `fixtures.ts`. `getCapabilities()` also short-circuits, so test runs make no gateway calls.
- **Always run e2e via `pnpm test`, never `npx playwright test`** — `PLAYWRIGHT=True` is set by the package.json script, not the Playwright config. A direct `npx` run boots without mocks, so mock-dependent tests silently hit the real gateway and fail on missing tool chips.
- `tests/evals/scribe/` — **live-model agent evals** for the scribe flow via Evalite (`pnpm eval:scribe`, costs real tokens; `:watch` re-runs on change, `:ui` serves results on localhost:3006). Sends kickoff messages to a live Kimi K2.5 agent running the production prompt and real tools against fixtures, then (a) checks the tool-call protocol deterministically (`checks.ts`) and (b) grades SOAP quality/documentation fidelity with LLM graders (`grader.ts`) — all binary Evalite scorers (subscores/rationales in metadata), so the default all-must-pass threshold holds. Enabled by `useMockModels`/`useOpenEmrFixtures` in `lib/constants.ts`: `OPENEMR_FIXTURES=true` (set in `setup.ts`) serves fixtures while models stay live; `PLAYWRIGHT=True` implies both. The created-encounter overlay is `AsyncLocalStorage`-scoped (`withFixtureState`, `fixtures.ts`) so concurrent eval rows don't see each other's writes. Root `vitest.config.ts` (evalite-only) aliases `server-only` and `@`. Env options: `SCRIBE_EVAL_CASE=<id>`, `SCRIBE_EVAL_TRIALS=<n>`, `SCRIBE_SKIP_GRADERS=true`; JSON export via `--outputPath=<path>`. Expect live-model variance.
- **Kill any running dev server before `pnpm test`.** Playwright reuses a server already on port 3000 (`reuseExistingServer: !process.env.CI`), and a plain `pnpm dev` server lacks `PLAYWRIGHT=True` — same silent real-model failure. A different port doesn't help either: Next.js 16 refuses a second dev server for the same project. Symptom: the failure snapshot shows a real reasoning response instead of the scripted tool flow.
- **Capturing UI screenshots**: boot `PLAYWRIGHT=True pnpm dev` (mocks + fixtures, no gateway/OpenEMR needed), drive with a standalone Playwright script via `node`. Outside-repo scripts can't `import` `@playwright/test` — use `createRequire("<repo>/package.json")("@playwright/test")`. Trigger a mock flow, screenshot `[data-role='assistant']`, capture both themes with one context per `colorScheme`. Shut down with SIGTERM. Driving the scribe **recording** flow needs the same media mocking `playwright.config.ts` sets up for e2e: launch Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` and grant `permissions: ["microphone"]` on the context — without both, `Start recording` hangs waiting for real mic access instead of the fake tone.
- **Driving the sidebar in scripts**: it starts **collapsed** in a fresh context (no `sidebar_state` cookie), hiding history links behind a hover-only overlay. Seed the cookie before `page.goto` (`context.addCookies([...])`) or click `sidebar-expand` first. Test ids: `sidebar-toggle`, `sidebar-expand`, `sidebar-home-link`, `sidebar-new-chat`, `sidebar-history-item`. Navigate client-side via these, not `page.goto` (which reloads and clears SWR/useChat state).
- **Stop dev servers gracefully — never `kill -9` mid-compile.** Next traps SIGTERM to finalize its Turbopack cache; SIGKILL can leave `.next` half-written, wedging the next start on `○ Compiling / ...`. Use Ctrl-C or `kill -15`. Recovery: `rm -rf .next node_modules/.cache` and restart.

## Frontend Aesthetics

Committed visual identity — the **medical authority aesthetic**. Work within it rather than importing a different design language.

**Avoid AI-generated defaults:**

- Generic fonts (Inter, Roboto, Arial, Space Grotesk, system-ui)
- Purple/violet gradients or accents
- `rounded-lg` on everything — this app uses `rounded-xl` for cards, `rounded-[5-6px]` for small badges
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
| `MERGE_AGENT_HANDLER_API_KEY` | Merge Agent Handler API key — enables NPI provider search over MCP (all three `MERGE_*` needed) |
| `MERGE_TOOL_PACK_ID` | Merge Tool Pack scoped to `search_individual_providers` |
| `MERGE_REGISTERED_USER_ID` | Shared Merge Registered User UUID |

OpenEMR OIDC is silently skipped (no crash) when its three required env vars are absent, so local dev without an OpenEMR instance works fine.
