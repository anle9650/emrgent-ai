import { generateDummyPassword } from "./db/utils";

export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

// isTestEnvironment bundles two swappable backends; these name them apart so
// eval runs can use canned OpenEMR data while still exercising live models.
export const useMockModels = isTestEnvironment;

// The TEST/EVAL backend: canned OpenEMR data for Playwright and evals. Swaps
// the backend wholesale *before* the auth check (see openemrRequest), because
// test sessions are never OpenEMR-connected; stateless per request by default
// (evals get a private overlay via withFixtureState). Not to be confused with
// useOpenEmrDemo below — that's the shippable demo, gated to be mutually
// exclusive with this one so test/eval runs stay deterministic.
export const useOpenEmrFixtures =
  isTestEnvironment || process.env.OPENEMR_FIXTURES === "true";

// The DEMO backend: a consistent, per-user *stateful* mock OpenEMR served to any
// session that isn't OpenEMR-connected (guests included), so the app — scribe
// flow and all — can be shown end-to-end with no real OpenEMR server. It differs
// from useOpenEmrFixtures on two load-bearing axes:
//   1. Activation timing — fixtures short-circuit *before* the auth check; demo
//      kicks in only *after* auth finds no OpenEMR token, so a genuinely
//      OpenEMR-connected user still reaches their live backend.
//   2. Hermeticity — the !isTestEnvironment guard makes the two mutually
//      exclusive, so test/eval runs (and the Redis-backed demo state) stay
//      deterministic even when the dev machine has OPENEMR_FIXTURES or REDIS_URL
//      set. Test/eval wins.
export const useOpenEmrDemo =
  !isTestEnvironment && process.env.OPENEMR_DEMO === "true";

export const guestRegex = /^guest-\d+$/;

export const DUMMY_PASSWORD = generateDummyPassword();

export const suggestions = [
  "Look up a patient by name",
  "Show recent encounters for a patient",
  "Summarize the SOAP note from a patient's last visit",
  "Draft a referral letter for a patient",
];
