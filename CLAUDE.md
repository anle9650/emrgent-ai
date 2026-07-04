# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev           # Start dev server (Next.js Turbopack)
pnpm build         # Runs DB migration then Next.js build
pnpm check         # Lint with Biome/ultracite (read-only)
pnpm fix           # Auto-fix lint issues
pnpm test          # Run Playwright e2e tests

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

- `patient.ts` — `searchPatients`, `getEncounters`, `getSoapNote` (calls OpenEMR REST API; strips PHI fields before returning to the model)
- `get-weather.ts` — demo weather tool
- `create-document.ts`, `edit-document.ts`, `update-document.ts`, `request-suggestions.ts` — artifact/document editing flow

Tools are registered in `app/(chat)/api/chat/route.ts`. Reasoning models (detected via the AI Gateway capabilities API) get an empty `activeTools` list.

### Artifacts (`artifacts/`)

Each artifact kind has a client definition in `artifacts/<kind>/client.tsx`, registered in `artifactDefinitions` in `components/chat/artifact.tsx` (which derives the `ArtifactKind` type). `text`/`code`/`sheet`/`image` persist versioned content to the `Document` table via `/api/document`; their AI generation handlers live in `lib/artifacts/server.ts`.

The `soap` kind is the exception: it edits a SOAP note that lives in OpenEMR, opened by clicking a SOAP note card in chat (`components/chat/soap-note.tsx`). It saves debounced edits through `PUT /api/openemr/soap-note`, has no `Document` rows or version history, and reports save state via artifact metadata (`saveState`). `DocumentArtifactKind` (= `ArtifactKind` minus `soap`) types all DB-facing paths — a new locally-persisted kind must also be added to the `Document.kind` enum in `lib/db/schema.ts`, the zod schema in `app/(chat)/api/document/route.ts`, and `lib/artifacts/server.ts`.

### Models (`lib/ai/models.ts`)

Models are accessed through the Vercel AI Gateway. Capabilities (tool support, vision, reasoning) are fetched live from the Gateway API and cached for 24 hours. `DEFAULT_CHAT_MODEL` is `moonshotai/kimi-k2.5`.

### Database (`lib/db/`)

Drizzle ORM with Postgres. Tables: `User`, `Chat`, `Message_v2`, `Vote_v2`, `Document`, `Suggestion`, `Stream`. `pnpm build` runs `lib/db/migrate.ts` automatically before the Next build.

### Styling

Tailwind CSS v4 with `@theme inline` in `app/globals.css`. Colors use oklch throughout. Design tokens:

- Light: ecru background, warm text, antiqued gold primary
- Dark: navy background, parchment text, lighter gold primary
- `--font-display` maps to Lora (loaded in `app/layout.tsx` via `next/font/google`), falling back to Georgia/serif
- Body has a prescription-paper diagonal-stripe watermark via `repeating-linear-gradient`

### Components

- `components/ui/` — shadcn/ui primitives generated by the `shadcn` CLI. Do not hand-edit; regenerate with the CLI instead. Excluded from Biome linting because the CLI's output style conflicts with ultracite's rules.
- `components/ai-elements/` — stream rendering primitives copied from the upstream Vercel AI Chatbot template. Also excluded from Biome linting for the same reason.
- `components/chat/` — all app-specific UI: sidebar, messages, artifact panel, patients card, etc. This is where new UI work goes.

The ECG waveform SVG (`<polyline points="0,9 10,9 13,4 16,14 19,1 22,14 25,9 44,9" />`) is the brand mark; it appears inline in `app-sidebar.tsx`, `greeting.tsx`, and `app/(auth)/layout.tsx` as a local `EcgIcon` component.

## Frontend Aesthetics

You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:

- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!

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
