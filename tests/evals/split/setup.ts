import { config } from "dotenv";

// Setup runs before the eval file's app imports, so these env vars are in
// place when lib/constants.ts reads them at module scope.
config({ path: ".env.local" });

// A mock-model run would grade lib/ai/models.mock.ts's canned detector, which
// is built to always answer correctly — a perfect score measuring nothing.
// Refuse rather than mislead.
if (process.env.PLAYWRIGHT) {
  throw new Error(
    "PLAYWRIGHT is set, which swaps in mock models — the split eval must run against the live gateway."
  );
}

if (!process.env.AI_GATEWAY_API_KEY) {
  throw new Error(
    "AI_GATEWAY_API_KEY is not set (checked env and .env.local) — the eval drives a live gateway model."
  );
}
