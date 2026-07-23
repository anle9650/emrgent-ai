# EMRgent AI

An ambient AI scribe for clinicians, backed by an [OpenEMR](https://www.open-emr.org) instance. Sign in with your OpenEMR account, record a visit, and the agent charts it end to end — scheduling the follow-up, reconciling the problem list and medications, filing an encounter with vitals and a SOAP note, placing any referrals discussed, and sending a visit summary message to the patient. Ask questions about patients, encounters, and appointments in plain language.

[**Features**](#features) ·
[**The Scribe Session**](#the-scribe-session) ·
[**How It Works**](#how-it-works) ·
[**Running Locally**](#running-locally) ·
[**Connecting to OpenEMR**](#connecting-to-openemr) ·
[**Provider Search**](#provider-search-npi-registry) ·
[**Project Structure**](#project-structure)

> **▶ [Try the live demo](https://emrgent-ai.vercel.app/)** — a hosted EMRgent AI with **demo mode** on, so you can run a full scribe session (canned recording and all) against a mock EMR without connecting your own OpenEMR instance. Continue as a guest to jump right in.

## Features

- **Ambient AI scribe** — record a clinical encounter, and the agent charts it end to end: schedules the follow-up, reconciles the problem list and medications, files a new encounter with vitals and a SOAP note, and sends the patient a plain-language visit summary — each write gated behind your approval. Closes by prompting the next roomed patient's scribe session in one click. See [The Scribe Session](#the-scribe-session).
- **OpenEMR as the AI's data source** — the model is equipped with tools that call the OpenEMR REST API on the signed-in user's behalf.
  - _Read_ — `searchPatients`, `getEncounters` (encounters with their SOAP note and vitals), `getSoapNote`, `getAppointments`, `getMedicalProblems` / `getMedications` / `getSurgeries` (patient's problem list, medications, and surgical history), and `getNextAppointment` (the next patient today who's roomed and waiting).
  - _Write_ — `createEncounter`, `createMedicalProblem` / `updateMedicalProblem`, `createMedication` / `updateMedication`, `createSurgery`, `createAppointment`, `sendMessage` (a plain-language visit-summary note through the patient's OpenEMR portal), and `sendReferral` (files a referral to another provider as an OpenEMR transaction). Every write is gated behind the clinician's approval before it reaches OpenEMR.
  - _Interactive_ — `selectAppointmentSlot` renders a slot picker in the chat and pauses the run until the clinician books or skips.
- **Generative UI** — the model decides per response whether a UI helps, and composes one declaratively (an [A2UI](https://a2ui.org)-inspired spec) from a trusted component catalog: rich patient/encounter/appointment cards plus generic primitives (tables, stats, badges) for comparisons and summaries.

Built with [Next.js 16](https://nextjs.org) App Router, the [AI SDK](https://ai-sdk.dev), [NextAuth v5](https://authjs.dev), [Drizzle ORM](https://orm.drizzle.team) + Postgres, and [Tailwind CSS v4](https://tailwindcss.com). Forked from the [Vercel AI Chatbot](https://github.com/vercel/ai-chatbot) template.

> **▶ [Take the interactive feature tour](https://claude.ai/code/artifact/a5fb5eda-ffed-4373-b3d3-938beda75879)** — a visual walkthrough of the scribe session, step by step.

## The Scribe Session

The scribe flow is the app's defining feature: a clinician records a visit, and the agent turns the raw room audio into structured chart writes — each one held for the clinician's approval before it touches OpenEMR.

### Recording (client)

1. **Pick the patient** — from an appointment on the schedule or a patient search (`components/chat/scribe/patient-select.tsx`).
2. **Record the encounter** — the recorder captures ambient room audio in segments and transcribes each one; the transcript is the mix of clinician and patient speech, dictation, and small talk (`recording-panel.tsx`, `use-scribe-session.tsx`).
3. **Kick off** — when recording finishes, the client packs the transcript into a single **kickoff message** (`lib/ai/scribe.ts`, `buildScribeKickoffMessage`), then hands off to the AI scribe agent.

### Charting (agent)

Driven by `scribePrompt` (`lib/ai/prompts.ts`), the agent works in ordered, single-purpose steps — pausing between them so nothing is written without the clinician's sign-off:

1. **Schedule the follow-up first** — while the patient is likely still in the room. If a return visit was discussed, the agent calls `selectAppointmentSlot`, an interactive tool that renders a slot picker.
2. **Chart updates** — every `updateMedicalProblem` / `updateMedication` the visit requires (resolved problems, discontinued meds).
3. **Chart creates** — new `createMedicalProblem` / `createMedication` / `createSurgery` calls.
4. **File the encounter** — exactly one `createEncounter` carrying the chief complaint, only the vitals actually spoken in the transcript, and a SOAP note whose assessment is informed by the prior chart.
5. **File any referrals** — if a referral was discussed, the agent looks up each provider's NPI with `search_individual_providers` (when [provider search](#provider-search-npi-registry) is configured), then files each one with `sendReferral`.
6. **Message the patient** — `sendMessage` sends a plain-language visit-summary note through the OpenEMR portal (no clinical jargon or codes).
7. **Wrap up** — a `ViewChartCard` to open the patient's completed chart, plus a short text summary of what changed.
8. **Prompt the next patient** — `getNextAppointment` gets the next patient today who's roomed, and renders a card the clinician can click to jump straight into that patient's scribe session.

The flow is covered end to end by live-model agent evals (`tests/evals/scribe/`, `pnpm eval:scribe`), which check the tool-call protocol deterministically and grade SOAP quality and documentation fidelity with LLM graders.

## How It Works

1. A clinician signs in via the **OpenEMR OIDC provider**. The JWT callback upserts a local user and stores the OpenEMR OAuth2 tokens in the encrypted session JWT, refreshing them as they near expiry.
2. Chat requests hit `app/(chat)/api/chat/route.ts`, which registers the OpenEMR tools.
3. When the model calls an OpenEMR tool, `openemrFetch` (`lib/openemr/api.ts`) reads the bearer token from the session and queries `OPENEMR_API_BASE`. API errors are returned to the model as structured objects so it can explain the problem instead of crashing the stream.
4. To show data, the model calls the `generateUI` tool with a declarative component spec; the client renders it from the trusted catalog (`components/chat/a2ui/`), resolving each domain card back to the referenced tool result.
5. Chat history, users, documents, and votes persist to Postgres via Drizzle.

If the OpenEMR environment variables are absent, the app switches to **demo mode**, and uses mock OpenEMR API fixtures.

## Running Locally

Requirements: Node.js, [pnpm](https://pnpm.io), and a Postgres database (e.g. [Neon](https://neon.tech)). The pnpm version is pinned via the `packageManager` field — run `corepack enable` once so `pnpm` matches it automatically.

1. Copy `.env.example` to `.env.local` and fill in at least:

   | Variable | Purpose |
   | --- | --- |
   | `AUTH_SECRET` | Session encryption — generate with `openssl rand -base64 32` |
   | `POSTGRES_URL` | Postgres connection string |
   | `AI_GATEWAY_API_KEY` | AI Gateway key (required off-Vercel) |
   | `REDIS_URL` | Optional — enables resumable streams |

2. Install and run:

   ```bash
   pnpm install
   pnpm db:migrate   # apply database migrations
   pnpm dev          # start dev server (Turbopack)
   ```

The app runs at [localhost:3000](http://localhost:3000). Without OpenEMR configured you can register a local account or continue as a guest.

> Never commit `.env.local` — it holds credentials for your database, AI provider, and EMR.

### Other commands

```bash
pnpm check           # Lint (Biome/ultracite, read-only)
pnpm fix             # Auto-fix lint issues
pnpm test            # Playwright e2e tests
pnpm test:unit       # Unit tests (node:test via tsx)
pnpm eval:scribe     # Scribe agent evals (Evalite) against a live model (uses gateway credits)
pnpm eval:scribe:ui  # Eval results UI with score history (localhost:3006)
pnpm db:generate     # Generate migrations from schema changes
pnpm db:studio       # Drizzle Studio GUI
```

## Connecting to OpenEMR

1. Run an OpenEMR instance with the REST API and OAuth2 enabled (a local Docker instance on `https://localhost:9300` works well).
2. Register an OAuth2 client at `{OPENEMR_ISSUER}/registration` with redirect URI `http://localhost:3000/api/auth/callback/openemr`, then enable it in OpenEMR under **Administration → System → API Clients**.
3. Set the OpenEMR variables in `.env.local`:

   | Variable | Example |
   | --- | --- |
   | `OPENEMR_ISSUER` | `https://localhost:9300/oauth2/default` |
   | `OPENEMR_CLIENT_ID` / `OPENEMR_CLIENT_SECRET` | From the client registration |
   | `OPENEMR_API_BASE` | `https://localhost:9300/apis/default` |
   | `OPENEMR_ALLOW_SELF_SIGNED` | `true` to accept a self-signed cert — **dev only** |

4. Restart the dev server. `OPENEMR_ALLOW_SELF_SIGNED` is applied in `instrumentation.ts` at startup, so it needs a full restart, not a hot reload.

A "Sign in with OpenEMR" option appears on the login page once all three OIDC variables are set.

## Provider Search (NPI Registry)

Optionally, the agent can search the national [NPI Registry](https://npiregistry.cms.hhs.gov) for individual healthcare providers — handy when drafting a referral or identifying a clinician. The tool (`search_individual_providers`) is served over [MCP](https://modelcontextprotocol.io) by [Merge Agent Handler](https://www.merge.dev), adapted into an AI SDK tool in `lib/ai/mcp/merge.ts` and registered alongside the OpenEMR tools. Once a provider is found, the agent can file a referral to them with the approval-gated `sendReferral` tool (recorded as an OpenEMR transaction) — during a scribe session this happens automatically whenever a referral is discussed.

1. In [Merge Agent Handler](https://ah.merge.dev), create an API key and a Tool Pack scoped to `search_individual_providers`, plus one shared Registered User (NPI data is public, so no per-user auth is needed).
2. Set all three variables in `.env.local`:

   | Variable | Purpose |
   | --- | --- |
   | `MERGE_AGENT_HANDLER_API_KEY` | Merge Agent Handler API key |
   | `MERGE_TOOL_PACK_ID` | Tool Pack containing `search_individual_providers` |
   | `MERGE_REGISTERED_USER_ID` | Shared Registered User UUID |

## Project Structure

```text
app/(auth)/        Sign-in, register, guest auth, NextAuth config
app/(chat)/        Chat UI, artifact editor, API routes
lib/ai/tools/      AI tools — openemr.ts (data), generate-ui.ts, select-appointment-slot.ts, documents
lib/ai/mcp/        MCP integrations — merge.ts (NPI Registry provider search)
lib/ai/scribe.ts   Scribe kickoff message — build/parse, chart-state helpers
lib/ai/prompts.ts  System prompt, including the scribe charting protocol
lib/ai/a2ui/       Generative UI spec — zod schema, validation, catalog docs
lib/ai/models.ts   Model list + AI Gateway capability detection
lib/openemr/       openemrFetch helper and error types
lib/db/            Drizzle schema, queries, migrations
components/chat/   App-specific UI (sidebar, messages, patients card…)
components/chat/scribe/  Scribe recording flow — patient select, recorder, kickoff
components/chat/a2ui/  Generative UI renderer — registry, primitives, domain cards
components/ui/     shadcn/ui primitives (generated — don't hand-edit)
```

## License

[Apache 2.0](LICENSE) — based on the Vercel AI Chatbot template.
