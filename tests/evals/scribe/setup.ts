import { config } from "dotenv";

// Setup runs before the eval file's app imports, so these env vars are in
// place when lib/constants.ts reads them at module scope.
config({ path: ".env.local" });

// Unconditional, not a guard: chart writes from this entry point must never
// be able to reach a live EMR, even under `pnpm exec evalite` directly.
process.env.OPENEMR_FIXTURES = "true";

if (!process.env.AI_GATEWAY_API_KEY) {
  throw new Error(
    "AI_GATEWAY_API_KEY is not set (checked env and .env.local) — the eval drives a live gateway model."
  );
}
