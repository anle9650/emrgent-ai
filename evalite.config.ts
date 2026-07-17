import { defineConfig } from "evalite/config";

export default defineConfig({
  // One row = a live agent run (up to 16 model steps) + two grader calls;
  // multi-minute is normal.
  testTimeout: 600_000,
  // Rows run at the default maxConcurrency (5): fixture state is
  // AsyncLocalStorage-scoped per row (withFixtureState), so parallel
  // rows/trials can't see each other's chart writes.
  // The old runner's --trials flag: SCRIBE_EVAL_TRIALS=3 pnpm eval:scribe
  trialCount: Math.max(1, Number(process.env.SCRIBE_EVAL_TRIALS ?? "1") || 1),
  setupFiles: ["./tests/evals/scribe/setup.ts"],
  // No scoreThreshold: the CLI default (100) plus binary scorers reproduces
  // the old all-must-pass exit-code semantics.
});
