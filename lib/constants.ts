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
export const useOpenEmrFixtures =
  isTestEnvironment || process.env.OPENEMR_FIXTURES === "true";

// Demo OpenEMR instance: serve a consistent, per-user stateful mock backend to
// any session that isn't OpenEMR-connected (guests included), so the app —
// including the scribe flow — can be shown end-to-end with no real OpenEMR
// server. Distinct from useOpenEmrFixtures: that swaps the backend wholesale
// under test/eval (before the auth check), whereas demo mode kicks in only
// AFTER auth finds no OpenEMR token (see openemrRequest). Mutually exclusive
// with the test/eval path so those runs keep their deterministic fixtures.
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
