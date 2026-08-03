import { createScorer, evalite } from "evalite";
import type { SplitEncounter } from "@/lib/ai/scribe-split";
import { splitTranscript } from "@/lib/ai/scribe-split-detect";
import { type SplitEvalCase, splitEvalCases, transcriptOf } from "./cases";
import { checkSplitRun } from "./checks";

// Live-model eval for the scribe split detector — does one recording hold one
// visit or several? Deterministic throughout: the multi-visit transcripts are
// spliced from real single-visit ones, so the correct answer is known by
// construction and no LLM judge is involved.
//
// The two failure modes are NOT symmetric, and the scoring reflects that:
//   - a missed split is the wrong-chart bug itself (patient B's history
//     written into patient A's record)
//   - a false split costs one click on "It's one visit", because nothing is
//     charted until the clinician confirms
// Both still fail a row — a model that splits everything is useless too — but
// that asymmetry is why the prompt deliberately carries no bias toward one
// visit, and why single-visit rows make up a third of the corpus rather than
// being treated as the safe default.

/** Gateway model id override, for reproducing the benchmark table on
 * scribeSplitModel: SPLIT_EVAL_MODEL=openai/gpt-oss-120b pnpm eval:split */
const modelOverride = process.env.SPLIT_EVAL_MODEL;

/** Detection blocks every session's kickoff, including the single-visit
 * majority, so latency is a correctness property here, not a nice-to-have.
 * The route aborts at 12s and the client gives up at 20s; 8s leaves headroom
 * while still turning red well before users feel it. Kimi K2.5's 40-86s is
 * what broke this feature in development. */
const LATENCY_BUDGET_MS = 8000;

type CaseInput = {
  caseId: string;
  expectedCount: number;
  currentPatientName: string;
  notes: string;
};

type SplitRun = { encounters: SplitEncounter[]; ms: number };

type ExpectedSummary = { visits: number; patients: string[] };

function caseOf(input: CaseInput): SplitEvalCase {
  const found = splitEvalCases.find((row) => row.id === input.caseId);
  if (!found) {
    throw new Error(`Unknown case "${input.caseId}"`);
  }
  return found;
}

const scorer = (
  name: string,
  description: string,
  score: (result: ReturnType<typeof checkSplitRun>, run: SplitRun) => boolean,
  metadata: (
    result: ReturnType<typeof checkSplitRun>,
    run: SplitRun
  ) => Record<string, unknown>
) =>
  createScorer<CaseInput, SplitRun, ExpectedSummary>({
    name,
    description,
    scorer: ({ input, output }) => {
      const result = checkSplitRun(caseOf(input), output.encounters);
      return {
        score: score(result, output) ? 1 : 0,
        metadata: { ...metadata(result, output), warnings: result.warnings },
      };
    },
  });

const encounterCount = scorer(
  "Encounter count",
  "Did the detector find the right number of visits?",
  (result) => result.countPass,
  (result) => ({
    detected: result.detectedCount,
    expected: result.expectedCount,
    verdict: result.countPass
      ? "correct"
      : result.detectedCount < result.expectedCount
        ? "MISSED SPLIT — one patient's speech would be charted to another"
        : "false split — costs the clinician one click, nothing is mischarted",
  })
);

const patientLabels = scorer(
  "Patient labels",
  "No invented patient names (a miss only warns; an invention mischarts)",
  (result) => result.hallucinatedLabels.length === 0,
  (result) => ({ hallucinated: result.hallucinatedLabels })
);

const boundaryPlacement = scorer(
  "Boundary placement",
  "Does each segment carry only its own visit's speech?",
  (result) => result.boundaryPass,
  (result) => ({
    contaminationWords: result.contaminationWords,
    detail: result.boundaryDetail,
  })
);

const verbatimSlices = scorer(
  "Verbatim slices",
  "Every segment is an exact slice of the input, and together they cover it",
  (result) => result.verbatimPass,
  (result) => ({ failures: result.verbatimFailures })
);

const latency = scorer(
  "Latency",
  `Detection completes under ${LATENCY_BUDGET_MS}ms (route aborts at 12s)`,
  (_result, run) => run.ms <= LATENCY_BUDGET_MS,
  (_result, run) => ({ ms: run.ms, budgetMs: LATENCY_BUDGET_MS })
);

evalite<CaseInput, SplitRun, ExpectedSummary>("Scribe split", {
  data: () => {
    // Mirrors SCRIBE_EVAL_CASE: SPLIT_EVAL_CASE=<id> pnpm eval:split
    const only = process.env.SPLIT_EVAL_CASE;
    const cases = only
      ? splitEvalCases.filter((row) => row.id === only)
      : splitEvalCases;
    if (cases.length === 0) {
      throw new Error(
        `No case named "${only}". Available: ${splitEvalCases
          .map((row) => row.id)
          .join(", ")}`
      );
    }
    return cases.map((evalCase) => ({
      input: {
        caseId: evalCase.id,
        expectedCount: evalCase.visits.length,
        currentPatientName: evalCase.currentPatientName,
        notes: evalCase.notes,
      },
      expected: {
        visits: evalCase.visits.length,
        patients: evalCase.visits.map((row) => row.patientName || "(unnamed)"),
      },
    }));
  },
  task: async (input) => {
    const evalCase = caseOf(input);
    const started = Date.now();
    // The real server pipeline: word floor, the shipped prompt, the real
    // sliceTranscript, and the same fail-soft catch. Only auth and request
    // parsing are missing.
    const encounters = await splitTranscript({
      transcript: transcriptOf(evalCase),
      currentPatientName: evalCase.currentPatientName,
      modelId: modelOverride,
    });
    return { encounters, ms: Date.now() - started };
  },
  scorers: [
    encounterCount,
    patientLabels,
    boundaryPlacement,
    verbatimSlices,
    latency,
  ],
  columns: ({ input, output }) => [
    { label: "Case", value: input.caseId },
    {
      label: "Visits",
      value: `${output.encounters.length}/${input.expectedCount}`,
    },
    { label: "ms", value: output.ms },
    {
      label: "Segments",
      value: output.encounters
        .map(
          (encounter) =>
            `[${encounter.patientName ?? "—"}] ${encounter.text.split(/\s+/).slice(0, 6).join(" ")}…`
        )
        .join("  |  "),
    },
  ],
});
