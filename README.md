# EMRgent AI

An AI scribe for clinicians that connects to an [OpenEMR](https://www.open-emr.org) instance — sign in with your OpenEMR account and ask questions about patients, encounters, and SOAP notes in plain language.

[**Features**](#features) ·
[**How It Works**](#how-it-works) ·
[**Running Locally**](#running-locally) ·
[**Connecting to OpenEMR**](#connecting-to-openemr) ·
[**Project Structure**](#project-structure)

## Features

- **OpenEMR as the AI's data source** — the model is equipped with tools that call the OpenEMR REST API on the signed-in user's behalf:
  - `searchPatients` — find patients by name or demographics
  - `getEncounters` — list a patient's encounters, each with its SOAP note and vitals
  - `getSoapNote` — retrieve the SOAP note for an encounter
  - `getAppointments` — list appointments, optionally per patient
  - `getMedicalProblems` / `getMedications` / `getSurgeries` — a patient's problem list, medications, and surgical history
- **Generative UI** — the model decides per response whether a UI helps, and composes one declaratively (an [A2UI](https://a2ui.org)-inspired spec) from a trusted component catalog: rich patient/encounter/appointment cards plus generic primitives (tables, stats, badges) for comparisons and summaries. Clinical data binds to tool results **by reference**.
- **Sign in with OpenEMR** — OIDC (OAuth2 + PKCE) against your OpenEMR instance, with automatic access-token refresh. Local email/password and guest sessions also work when no OpenEMR instance is configured.

Built with [Next.js 16](https://nextjs.org) App Router, the [AI SDK](https://ai-sdk.dev), [NextAuth v5](https://authjs.dev), [Drizzle ORM](https://orm.drizzle.team) + Postgres, and [Tailwind CSS v4](https://tailwindcss.com). Forked from the [Vercel AI Chatbot](https://github.com/vercel/ai-chatbot) template.

## How It Works

1. A clinician signs in via the **OpenEMR OIDC provider**. The JWT callback upserts a local user and stores the OpenEMR OAuth2 tokens in the encrypted session JWT, refreshing them as they near expiry.
2. Chat requests hit `app/(chat)/api/chat/route.ts`, which registers the patient tools alongside the standard artifact/document tools.
3. When the model calls a patient tool, `openemrFetch` (`lib/openemr/api.ts`) reads the bearer token from the session and queries `OPENEMR_API_BASE`. API errors are returned to the model as structured objects so it can explain the problem instead of crashing the stream.
4. Data tool results render only as collapsed tool chrome. To show data, the model calls the `generateUI` tool with a declarative component spec; the client renders it from the trusted catalog (`components/chat/a2ui/`), resolving each domain card back to the referenced tool result.
5. Chat history, users, documents, and votes persist to Postgres via Drizzle.

If the OpenEMR environment variables are absent, the OIDC provider and patient tools degrade gracefully — the app runs as a regular chatbot with local auth.

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

## Project Structure

```text
app/(auth)/        Sign-in, register, guest auth, NextAuth config
app/(chat)/        Chat UI, artifact editor, API routes
lib/ai/tools/      AI tools — openemr.ts (data), generate-ui.ts, documents, weather
lib/ai/a2ui/       Generative UI spec — zod schema, validation, catalog docs
lib/ai/models.ts   Model list + AI Gateway capability detection
lib/openemr/       openemrFetch helper and error types
lib/db/            Drizzle schema, queries, migrations
components/chat/   App-specific UI (sidebar, messages, patients card…)
components/chat/a2ui/  Generative UI renderer — registry, primitives, domain cards
components/ui/     shadcn/ui primitives (generated — don't hand-edit)
```

## License

[Apache 2.0](LICENSE) — based on the Vercel AI Chatbot template.
