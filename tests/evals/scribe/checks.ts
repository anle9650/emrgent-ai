import { differenceInCalendarDays } from "date-fns";
import { SCRIBE_PRIOR_CHART_MARKER } from "@/lib/ai/scribe";
import type { ScribeRun, ScribeToolCall } from "./agent";
import type { ScribeEvalCase, WriteMatcher } from "./cases";

const WRITE_TOOLS = new Set([
  "createEncounter",
  "createMedicalProblem",
  "updateMedicalProblem",
  "createMedication",
  "updateMedication",
  "createSurgery",
]);

// getEncounters is not a required context read: it's only a fallback for a
// prior-chart section marked unavailable. The protocol's closing step is now
// generateUI(ViewChartCard) (enforced by checkGenerateUi), not getEncounters.
const CONTEXT_READS = ["getMedicalProblems", "getMedications", "getSurgeries"];

export type CheckResult = {
  pass: boolean;
  failures: string[];
  warnings: string[];
};

const patientUuidOf = (call: ScribeToolCall) =>
  (call.input.patient as Record<string, unknown> | undefined)?.uuid;

function checkContextReads(
  evalCase: ScribeEvalCase,
  run: ScribeRun,
  failures: string[],
  warnings: string[]
) {
  const toolCalls = run.toolCalls;

  if (run.kickoff.includes(SCRIBE_PRIOR_CHART_MARKER)) {
    // The kickoff already carries the chart: re-fetching a provided section
    // wastes a model step but charts nothing wrong — warn, don't fail.
    // Sections the block itself marked unavailable are fair game.
    for (const readTool of CONTEXT_READS) {
      const provided = !run.kickoff.includes(`call ${readTool} to fetch`);
      if (provided && toolCalls.some((call) => call.toolName === readTool)) {
        warnings.push(
          `${readTool} was called even though the kickoff's prior chart already provided that section`
        );
      }
    }
    return;
  }

  // No prior-chart block (prefetch failed / omitPriorChart case): the
  // protocol's fallback applies — the three chart reads, before any write.
  const writeSteps = toolCalls
    .filter((call) => WRITE_TOOLS.has(call.toolName))
    .map((call) => call.step);
  const firstWriteStep = writeSteps.length > 0 ? Math.min(...writeSteps) : null;

  for (const readTool of CONTEXT_READS) {
    const read = toolCalls.find(
      (call) =>
        call.toolName === readTool &&
        patientUuidOf(call) === evalCase.patient.uuid
    );
    if (!read) {
      failures.push(
        `context read ${readTool} was never called for ${evalCase.patient.name}`
      );
    } else if (firstWriteStep !== null && read.step >= firstWriteStep) {
      failures.push(
        `${readTool} (step ${read.step}) ran at/after the first write (step ${firstWriteStep}) — context must be gathered before charting`
      );
    }
  }
}

function checkVitals(
  evalCase: ScribeEvalCase,
  encounterInput: Record<string, unknown>,
  failures: string[]
) {
  const vitals = (encounterInput.vitals ?? {}) as Record<string, unknown>;
  const charted = Object.entries(vitals).filter(
    ([, value]) => value !== undefined && value !== null
  );

  if (evalCase.expectedVitals === "none") {
    if (charted.length > 0) {
      failures.push(
        `vitals were charted but none were stated in the transcript: ${JSON.stringify(
          Object.fromEntries(charted)
        )}`
      );
    }
    return;
  }

  for (const [key, value] of charted) {
    const expected = evalCase.expectedVitals[key];
    if (expected === undefined) {
      failures.push(
        `vital "${key}" (${String(value)}) was charted but never stated in the transcript`
      );
    } else if (Number(value) !== expected) {
      failures.push(
        `vital "${key}" charted as ${String(value)}, transcript states ${expected}`
      );
    }
  }
  for (const [key, expected] of Object.entries(evalCase.expectedVitals)) {
    if (!charted.some(([chartedKey]) => chartedKey === key)) {
      failures.push(
        `vital "${key}" (${expected}) was stated in the transcript but not charted`
      );
    }
  }
}

function checkEncounter(
  evalCase: ScribeEvalCase,
  toolCalls: ScribeToolCall[],
  failures: string[],
  warnings: string[],
  visitDate: string
) {
  const encounters = toolCalls.filter(
    (call) => call.toolName === "createEncounter"
  );
  if (encounters.length !== 1) {
    failures.push(
      `expected exactly one createEncounter, got ${encounters.length}`
    );
    if (encounters.length === 0) {
      return;
    }
  }
  const input = encounters[0].input;

  const patient = input.patient as Record<string, unknown> | undefined;
  if (
    patient?.uuid !== evalCase.patient.uuid ||
    patient?.pid !== evalCase.patient.pid
  ) {
    failures.push(
      `createEncounter patient ${JSON.stringify(patient)} is not ${evalCase.patient.name}`
    );
  }

  if (typeof input.date === "string" && input.date !== visitDate) {
    warnings.push(
      `createEncounter date ${input.date} differs from the visit date ${visitDate}`
    );
  }

  const soapNote = input.soapNote as Record<string, unknown> | undefined;
  if (soapNote) {
    for (const section of ["subjective", "assessment", "plan"] as const) {
      if (!String(soapNote[section] ?? "").trim()) {
        failures.push(`SOAP note ${section} is empty`);
      }
    }
  } else {
    failures.push("createEncounter has no soapNote");
  }

  checkVitals(evalCase, input, failures);
}

function checkExpectedWrites(
  evalCase: ScribeEvalCase,
  toolCalls: ScribeToolCall[],
  failures: string[]
) {
  const writes = toolCalls.filter(
    (call) =>
      WRITE_TOOLS.has(call.toolName) && call.toolName !== "createEncounter"
  );
  const unconsumed: WriteMatcher[] = [...evalCase.expectedWrites];

  for (const write of writes) {
    let mismatchReasons: string[] | null = null;
    const index = unconsumed.findIndex((matcher) => {
      if (matcher.tool !== write.toolName) {
        return false;
      }
      const reasons = matcher.match(write.input);
      if (reasons.length === 0) {
        return true;
      }
      mismatchReasons ??= reasons;
      return false;
    });
    if (index >= 0) {
      unconsumed.splice(index, 1);
    } else {
      // Writes are forbidden by default: anything no matcher accounts for is
      // over-charting.
      const detail = mismatchReasons
        ? ` (nearest matcher rejected it: ${(mismatchReasons as string[]).join("; ")})`
        : "";
      failures.push(
        `unexpected write ${write.toolName}(${JSON.stringify(write.input).slice(0, 160)})${detail}`
      );
    }
  }

  for (const matcher of unconsumed) {
    if (!matcher.optional) {
      failures.push(`required write missing: ${matcher.label}`);
    }
  }
}

function checkToolErrors(
  run: ScribeRun,
  failures: string[],
  warnings: string[]
) {
  const errored = run.toolResults.filter(
    (result) =>
      result.output &&
      typeof result.output === "object" &&
      "error" in (result.output as Record<string, unknown>)
  );
  for (const result of errored) {
    const message = String((result.output as { error: unknown }).error).slice(
      0,
      160
    );
    // A generateUI attempt the model successfully retried renders collapsed
    // in the real UI — count it as noise, not a charting failure.
    const retried =
      result.toolName === "generateUI" &&
      run.toolResults.some(
        (other) =>
          other.toolName === "generateUI" &&
          other !== result &&
          other.output &&
          typeof other.output === "object" &&
          !("error" in (other.output as Record<string, unknown>))
      );
    if (retried) {
      warnings.push(`generateUI error (retried successfully): ${message}`);
    } else {
      failures.push(`${result.toolName} returned an error: ${message}`);
    }
  }
}

function checkGenerateUi(toolCalls: ScribeToolCall[], failures: string[]) {
  const surfaces = toolCalls.filter((call) => call.toolName === "generateUI");
  const hasViewChartCard = surfaces.some((call) =>
    (call.input.components as Record<string, unknown>[] | undefined)?.some(
      (component) => component.component === "ViewChartCard"
    )
  );
  if (!hasViewChartCard) {
    failures.push(
      "the protocol's closing generateUI(ViewChartCard) never happened"
    );
  }
}

// Protocol step 3: a discussed recheck must produce a `selectAppointmentSlot`
// call for this patient, rendered as its own step BEFORE any chart write (the
// patient is still in the room); no discussed recheck must produce none. When
// the picker resolves with a slot, `createAppointment` must book that exact
// slot. The date window is fuzzy transcript phrasing, so it only warns.
function checkFollowUpScheduling(
  evalCase: ScribeEvalCase,
  run: ScribeRun,
  failures: string[],
  warnings: string[]
) {
  const slotSelections = run.toolCalls.filter(
    (call) => call.toolName === "selectAppointmentSlot"
  );
  const bookings = run.toolCalls.filter(
    (call) => call.toolName === "createAppointment"
  );

  if (evalCase.expectedFollowUp === "none") {
    if (slotSelections.length > 0) {
      failures.push(
        "selectAppointmentSlot was called but no return visit was discussed — over-scheduling"
      );
    }
    if (bookings.length > 0) {
      failures.push(
        "createAppointment was called but no return visit was discussed"
      );
    }
    return;
  }

  if (slotSelections.length === 0) {
    failures.push(
      "a follow-up was discussed but selectAppointmentSlot was never called"
    );
    return;
  }

  const forPatient = slotSelections.filter(
    (call) =>
      (call.input.patient as Record<string, unknown> | undefined)?.pid ===
      evalCase.patient.pid
  );
  if (forPatient.length === 0) {
    failures.push(
      `no selectAppointmentSlot call carries ${evalCase.patient.name}'s pid ${evalCase.patient.pid}`
    );
  }

  // Step 3 shows the picker BEFORE any chart write — so the patient can pick
  // while the writes wait on the clinician's approvals. A picker after the
  // writes charts fine but defeats the point, so it fails here.
  const firstWriteStep = Math.min(
    ...run.toolCalls
      .filter((call) => WRITE_TOOLS.has(call.toolName))
      .map((call) => call.step)
  );
  const selectStep = Math.min(...slotSelections.map((call) => call.step));
  if (Number.isFinite(firstWriteStep) && selectStep > firstWriteStep) {
    failures.push(
      `selectAppointmentSlot (step ${selectStep}) ran after the first chart write (step ${firstWriteStep}) — it must be called first, before the writes`
    );
  }

  // When the (stubbed) picker resolved with a slot, the model must book that
  // exact slot with createAppointment — copied verbatim, never invented.
  const resolvedWithSlot = run.toolResults.some(
    (result) =>
      result.toolName === "selectAppointmentSlot" &&
      result.output != null &&
      typeof result.output === "object" &&
      "chosenSlot" in result.output
  );
  if (resolvedWithSlot) {
    if (bookings.length === 0) {
      failures.push(
        "the picker resolved with a chosen slot but createAppointment was never called to book it"
      );
    } else if (
      !bookings.some(
        (call) => call.input.slot && typeof call.input.slot === "object"
      )
    ) {
      failures.push(
        "createAppointment was called without a `slot` copied from the picker's chosen slot"
      );
    }
  }

  // Warn-only window check: startDate should land near the discussed
  // interval. A missing startDate means the tool defaulted to today.
  const [minDays, maxDays] = evalCase.expectedFollowUp.withinDays;
  for (const call of forPatient) {
    const startDate =
      typeof call.input.startDate === "string" ? call.input.startDate : null;
    const daysOut = startDate
      ? differenceInCalendarDays(new Date(startDate), new Date(run.visitDate))
      : 0;
    if (daysOut < minDays || daysOut > maxDays) {
      warnings.push(
        `slot search startDate ${startDate ?? "(default: today)"} is ${daysOut} days out — transcript suggests ${minDays}–${maxDays}`
      );
    }
  }

  checkFollowUpDuration(evalCase, forPatient, failures, warnings);
}

// The slot search's `duration` (seconds) must be a positive multiple of 900
// (the prompt's 15-minute-increment invariant) — a hard check. Whether it
// lands on the case's expected value (simple=900 vs complex=1800+) only warns,
// since visit complexity is a fuzzy judgment call.
function checkFollowUpDuration(
  evalCase: ScribeEvalCase,
  forPatient: ScribeToolCall[],
  failures: string[],
  warnings: string[]
) {
  for (const call of forPatient) {
    const duration = call.input.duration;
    if (typeof duration !== "number" || duration <= 0 || duration % 900 !== 0) {
      failures.push(
        `selectAppointmentSlot duration ${String(duration)} is not a positive multiple of 900 (15-minute increments)`
      );
      continue;
    }
    if (
      evalCase.expectedDuration !== undefined &&
      duration !== evalCase.expectedDuration
    ) {
      warnings.push(
        `slot search duration ${duration}s differs from the expected ${evalCase.expectedDuration}s for this visit's complexity`
      );
    }
  }
}

const UPDATE_TOOLS = new Set(["updateMedicalProblem", "updateMedication"]);
const CREATE_TOOLS = new Set([
  "createMedicalProblem",
  "createMedication",
  "createSurgery",
]);

// Protocol steps 4–6: the chart writes go out as staged approval waves so
// the clinician is not flooded with cards — ALL updates in one step, then
// ALL creates in one step, then createEncounter alone, in that order. The
// harness has no approval gate (writes auto-execute), but the step index
// still records how the model batched them.
function checkWriteStaging(run: ScribeRun, failures: string[]) {
  const stepsOf = (names: Set<string>) =>
    run.toolCalls
      .filter((call) => names.has(call.toolName))
      .map((call) => call.step);
  const updateSteps = stepsOf(UPDATE_TOOLS);
  const createSteps = stepsOf(CREATE_TOOLS);
  const encounterSteps = stepsOf(new Set(["createEncounter"]));

  if (new Set(updateSteps).size > 1) {
    failures.push(
      `the update writes span steps ${[...new Set(updateSteps)].join(", ")} — all updates must go out together in ONE approval wave`
    );
  }
  if (new Set(createSteps).size > 1) {
    failures.push(
      `the create writes span steps ${[...new Set(createSteps)].join(", ")} — all creates must go out together in ONE approval wave`
    );
  }
  for (const encounterStep of encounterSteps) {
    const sharing = run.toolCalls.filter(
      (call) =>
        call.step === encounterStep &&
        WRITE_TOOLS.has(call.toolName) &&
        call.toolName !== "createEncounter"
    );
    if (sharing.length > 0) {
      failures.push(
        `createEncounter (step ${encounterStep}) shares its step with ${sharing.map((call) => call.toolName).join(", ")} — the encounter must be proposed ALONE`
      );
    }
  }

  // Wave ordering: updates before creates before the encounter, each wave
  // strictly earlier than the next present one.
  if (
    updateSteps.length > 0 &&
    createSteps.length > 0 &&
    Math.max(...updateSteps) >= Math.min(...createSteps)
  ) {
    failures.push(
      "an update write ran at/after the create wave — updates must be approved first"
    );
  }
  const priorWriteSteps = [...updateSteps, ...createSteps];
  if (
    priorWriteSteps.length > 0 &&
    encounterSteps.length > 0 &&
    Math.max(...priorWriteSteps) >= Math.min(...encounterSteps)
  ) {
    failures.push(
      "a problem/medication/surgery write ran at/after the createEncounter step — the encounter wave must come last"
    );
  }
}

/**
 * Deterministic protocol checks: encode the scribe system prompt's charting
 * protocol (lib/ai/prompts.ts scribePrompt) plus the per-case expected
 * writes as pass/fail assertions over the run's tool calls.
 */
export function checkScribeRun(
  evalCase: ScribeEvalCase,
  run: ScribeRun
): CheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (run.toolCalls.some((call) => call.toolName === "searchPatients")) {
    failures.push(
      "searchPatients was called — the kickoff already carries the patient ref"
    );
  }

  checkContextReads(evalCase, run, failures, warnings);
  checkEncounter(evalCase, run.toolCalls, failures, warnings, run.visitDate);
  checkExpectedWrites(evalCase, run.toolCalls, failures);
  checkToolErrors(run, failures, warnings);
  checkGenerateUi(run.toolCalls, failures);
  checkFollowUpScheduling(evalCase, run, failures, warnings);
  checkWriteStaging(run, failures);

  if (!run.text.trim()) {
    failures.push("the run produced no closing text summary");
  }

  return { pass: failures.length === 0, failures, warnings };
}
