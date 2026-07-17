import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { config } from "dotenv";

config({ path: ".env.local" });

// These imports pull in lib/constants.ts, which reads OPENEMR_FIXTURES at
// module load — keep them after dotenv, and fail fast below if the flag is
// missing (writes would otherwise hit a live OpenEMR).
import { resetOpenEmrFixtureState } from "@/lib/openemr/fixtures";
import { runScribeSession, SCRIBE_EVAL_MODEL, type ScribeRun } from "./agent";
import { type ScribeEvalCase, scribeEvalCases } from "./cases";
import { type CheckResult, checkScribeRun } from "./checks";
import { type Grade, gradeFidelity, gradeSoapQuality } from "./grader";

type TrialReport = {
  caseId: string;
  trial: number;
  checks: CheckResult;
  soapQuality?: Grade;
  fidelity?: Grade;
  toolCallTrace: string[];
  error?: string;
};

function summarizeInput(toolName: string, input: Record<string, unknown>) {
  const patient = input.patient as Record<string, unknown> | undefined;
  const parts: string[] = [];
  if (patient?.name) {
    parts.push(`patient=${String(patient.name)}`);
  }
  for (const key of ["title", "reason", "enddate", "startDate", "endDate"]) {
    if (input[key] !== undefined && input[key] !== null) {
      parts.push(`${key}=${JSON.stringify(input[key])}`);
    }
  }
  if (toolName === "createEncounter") {
    parts.push(`vitals=${JSON.stringify(input.vitals ?? null)}`);
    parts.push(input.soapNote ? "soapNote=✓" : "soapNote=✗");
  }
  return parts.join(", ");
}

const gradeLine = (label: string, grade: Grade) =>
  `${label}: accuracy ${grade.accuracy}/5, completeness ${grade.completeness}/5, ` +
  `no-hallucination ${grade.noHallucination}/5 — ${grade.pass ? "PASS" : "FAIL"}\n` +
  `    ${grade.rationale}`;

async function runTrial(
  evalCase: ScribeEvalCase,
  trial: number,
  skipGraders: boolean
): Promise<TrialReport> {
  // The fixture overlay is module-global state, which is why trials run
  // sequentially: concurrent runs against the same patient would see each
  // other's created encounters.
  resetOpenEmrFixtureState();

  let run: ScribeRun;
  try {
    run = await runScribeSession(evalCase);
  } catch (error) {
    return {
      caseId: evalCase.id,
      trial,
      checks: {
        pass: false,
        failures: [`agent run failed: ${String(error)}`],
        warnings: [],
      },
      toolCallTrace: [],
      error: String(error),
    };
  }

  const toolCallTrace = run.toolCalls.map(
    (call) =>
      `step ${call.step}: ${call.toolName}(${summarizeInput(call.toolName, call.input)})`
  );
  const checks = checkScribeRun(evalCase, run);

  if (skipGraders) {
    return { caseId: evalCase.id, trial, checks, toolCallTrace };
  }

  const [soapQuality, fidelity] = await Promise.all([
    gradeSoapQuality(evalCase, run),
    gradeFidelity(evalCase, run),
  ]);
  return {
    caseId: evalCase.id,
    trial,
    checks,
    soapQuality,
    fidelity,
    toolCallTrace,
  };
}

function printTrial(report: TrialReport, trials: number) {
  const heading =
    trials > 1
      ? `${report.caseId} (trial ${report.trial}/${trials})`
      : report.caseId;
  console.log(`\n=== ${heading} ===`);
  for (const line of report.toolCallTrace) {
    console.log(`  ${line}`);
  }
  console.log(
    `  tool checks: ${report.checks.pass ? "PASS" : "FAIL"}${
      report.checks.failures.length > 0
        ? `\n${report.checks.failures.map((f) => `    ✗ ${f}`).join("\n")}`
        : ""
    }`
  );
  for (const warning of report.checks.warnings) {
    console.log(`    ⚠ ${warning}`);
  }
  if (report.soapQuality) {
    console.log(`  ${gradeLine("SOAP quality", report.soapQuality)}`);
  }
  if (report.fidelity) {
    console.log(`  ${gradeLine("fidelity", report.fidelity)}`);
  }
}

const trialPassed = (report: TrialReport) =>
  report.checks.pass &&
  (report.soapQuality?.pass ?? true) &&
  (report.fidelity?.pass ?? true);

async function main() {
  // pnpm forwards the "--" separator itself, and parseArgs would treat
  // everything after it as positional — drop it so the flags still parse.
  const args = process.argv
    .slice(2)
    .filter((arg, i) => !(i === 0 && arg === "--"));
  const { values } = parseArgs({
    args,
    options: {
      case: { type: "string" },
      trials: { type: "string", default: "1" },
      "skip-graders": { type: "boolean", default: false },
      json: { type: "string" },
    },
  });

  if (process.env.OPENEMR_FIXTURES !== "true") {
    console.error(
      "OPENEMR_FIXTURES must be 'true' so chart writes hit fixtures, never a real EMR. Run via: pnpm eval:scribe"
    );
    process.exit(1);
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error(
      "AI_GATEWAY_API_KEY is not set (checked env and .env.local) — the eval needs the live gateway."
    );
    process.exit(1);
  }

  const cases = values.case
    ? scribeEvalCases.filter((c) => c.id === values.case)
    : scribeEvalCases;
  if (cases.length === 0) {
    console.error(
      `No case named "${values.case}". Available: ${scribeEvalCases.map((c) => c.id).join(", ")}`
    );
    process.exit(1);
  }
  const trials = Math.max(1, Number(values.trials) || 1);

  console.log(
    `Scribe eval: ${cases.length} case(s) × ${trials} trial(s), model ${SCRIBE_EVAL_MODEL}` +
      `${values["skip-graders"] ? ", graders skipped" : ""}`
  );

  const reports: TrialReport[] = [];
  for (const evalCase of cases) {
    for (let trial = 1; trial <= trials; trial++) {
      const report = await runTrial(evalCase, trial, values["skip-graders"]);
      printTrial(report, trials);
      reports.push(report);
    }
  }

  console.log("\n=== Summary ===");
  for (const report of reports) {
    const grades = report.soapQuality
      ? ` | soap ${report.soapQuality.pass ? "pass" : "FAIL"} | fidelity ${report.fidelity?.pass ? "pass" : "FAIL"}`
      : "";
    console.log(
      `  ${trialPassed(report) ? "PASS" : "FAIL"}  ${report.caseId}` +
        `${trials > 1 ? ` #${report.trial}` : ""} — checks ${
          report.checks.pass
            ? "pass"
            : `FAIL (${report.checks.failures.length})`
        }${grades}`
    );
  }
  const failed = reports.filter((report) => !trialPassed(report));
  console.log(`\n${reports.length - failed.length}/${reports.length} passed`);

  if (values.json) {
    writeFileSync(values.json, JSON.stringify(reports, null, 2));
    console.log(`Wrote ${values.json}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
