import { createScorer, evalite } from "evalite";
import { withFixtureState } from "@/lib/openemr/fixtures";
import { runScribeSession, type ScribeRun } from "./agent";
import { type ScribeEvalCase, scribeEvalCases } from "./cases";
import { checkScribeRun } from "./checks";
import { type Grade, gradeFidelity, gradeSoapQuality } from "./grader";

// The full case object holds matcher FUNCTIONS (WriteMatcher.match), which
// don't survive evalite's sqlite JSON serialization — so the eval input is a
// serializable descriptor and the task/scorers re-resolve the case by id.
type CaseInput = {
  caseId: string;
  patient: string;
  transcript: string;
  omitPriorChart?: boolean;
};

// Display-only "expected" summary shown in the UI; the executable matchers
// stay in cases.ts (functions don't survive sqlite JSON serialization).
type ExpectedSummary = {
  writes: string[];
  vitals: ScribeEvalCase["expectedVitals"];
  followUp: string;
};

function caseOf(input: CaseInput): ScribeEvalCase {
  const evalCase = scribeEvalCases.find((row) => row.id === input.caseId);
  if (!evalCase) {
    throw new Error(`Unknown case "${input.caseId}"`);
  }
  return evalCase;
}

const protocolChecks = createScorer<CaseInput, ScribeRun, ExpectedSummary>({
  name: "Protocol checks",
  description: "Deterministic charting-protocol assertions (checks.ts)",
  scorer: ({ input, output }) => {
    const result = checkScribeRun(caseOf(input), output);
    return {
      score: result.pass ? 1 : 0,
      metadata: { failures: result.failures, warnings: result.warnings },
    };
  },
});

// Binary score from Grade.pass — the gate the old runner used. The 1-5
// subscores and rationale go to metadata (visible in the UI), NOT into the
// score: averaging subscores would break the threshold-100 = all-must-pass
// exit-code semantics.
const gradeScorer = (
  name: string,
  description: string,
  grade: (evalCase: ScribeEvalCase, run: ScribeRun) => Promise<Grade>
) =>
  createScorer<CaseInput, ScribeRun, ExpectedSummary>({
    name,
    description,
    scorer: async ({ input, output }) => {
      const result = await grade(caseOf(input), output);
      return { score: result.pass ? 1 : 0, metadata: result };
    },
  });

const soapQuality = gradeScorer(
  "SOAP quality",
  "LLM judge: note structure, clarity, and S/O/A/P placement",
  gradeSoapQuality
);
const fidelity = gradeScorer(
  "Fidelity",
  "LLM judge: chart writes vs transcript + prior chart",
  gradeFidelity
);

// The old runner's --skip-graders flag: SCRIBE_SKIP_GRADERS=true runs the
// deterministic checks only, keeping fake grades out of the score history.
const skipGraders = process.env.SCRIBE_SKIP_GRADERS === "true";

evalite<CaseInput, ScribeRun, ExpectedSummary>("Scribe", {
  data: () => {
    // The old runner's --case flag: SCRIBE_EVAL_CASE=<id> pnpm eval:scribe
    const only = process.env.SCRIBE_EVAL_CASE;
    const cases = only
      ? scribeEvalCases.filter((row) => row.id === only)
      : scribeEvalCases;
    if (cases.length === 0) {
      throw new Error(
        `No case named "${only}". Available: ${scribeEvalCases
          .map((row) => row.id)
          .join(", ")}`
      );
    }
    return cases.map((evalCase) => ({
      input: {
        caseId: evalCase.id,
        patient: evalCase.patient.name,
        transcript: evalCase.transcript,
        omitPriorChart: evalCase.omitPriorChart,
      },
      // Display-only summary; the executable matchers stay in cases.ts.
      expected: {
        writes: evalCase.expectedWrites.map(
          (matcher) =>
            `${matcher.optional ? "(optional) " : ""}${matcher.label}`
        ),
        vitals: evalCase.expectedVitals,
        followUp:
          evalCase.expectedFollowUp === "none"
            ? "none"
            : `slot search ~${evalCase.expectedFollowUp.withinDays[0]}–${evalCase.expectedFollowUp.withinDays[1]} days out`,
      },
    }));
  },
  task: (input) => {
    const { patient, transcript, omitPriorChart } = caseOf(input);
    // Private per-row fixture overlay: the prior-chart prefetch inside
    // runScribeSession sees a pristine chart, and concurrent rows/trials
    // can't see each other's created encounters.
    return withFixtureState(() =>
      runScribeSession({ patient, transcript, omitPriorChart })
    );
  },
  scorers: skipGraders
    ? [protocolChecks]
    : [protocolChecks, soapQuality, fidelity],
  columns: ({ input, output }) => [
    { label: "Case", value: input.caseId },
    {
      label: "Tool calls",
      value: output.toolCalls.map((call) => call.toolName).join(" → "),
    },
  ],
});
