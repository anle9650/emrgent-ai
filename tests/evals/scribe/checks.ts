import { differenceInCalendarDays } from "date-fns";
import { SCRIBE_PRIOR_CHART_MARKER } from "@/lib/ai/scribe";
import {
  PROVIDER_SEARCH_TOOL_NAME,
  type ScribeRun,
  type ScribeToolCall,
} from "./agent";
import type { ReferralMatcher, ScribeEvalCase, WriteMatcher } from "./cases";

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

// Protocol step 7: after the encounter is filed, exactly one visit-summary
// `sendMessage` goes to the patient, carrying this patient's pid and a
// non-empty title + body. The sender (`from`) is resolved server-side and the
// body text is fuzzy prose, so neither is hard-asserted here.
function checkPortalMessage(
  evalCase: ScribeEvalCase,
  run: ScribeRun,
  failures: string[]
) {
  const messages = run.toolCalls.filter(
    (call) => call.toolName === "sendMessage"
  );
  if (messages.length !== 1) {
    failures.push(
      `expected exactly one sendMessage (visit summary), got ${messages.length}`
    );
    return;
  }
  const input = messages[0].input;
  const patient = input.patient as Record<string, unknown> | undefined;
  if (patient?.pid !== evalCase.patient.pid) {
    failures.push(
      `sendMessage patient ${JSON.stringify(patient)} is not ${evalCase.patient.name} (pid ${evalCase.patient.pid})`
    );
  }
  if (!String(input.title ?? "").trim()) {
    failures.push("sendMessage has an empty title");
  }
  if (!String(input.body ?? "").trim()) {
    failures.push("sendMessage has an empty body");
  }
}

// Protocol step 9: after charting, exactly one `getNextAppointment` call
// surfaces the next roomed patient, in a step strictly after the encounter is
// filed. It's a read (not in WRITE_TOOLS), and the returned patient is
// fixture-dependent, so only the call's existence and ordering are asserted.
function checkNextAppointment(run: ScribeRun, failures: string[]) {
  const calls = run.toolCalls.filter(
    (call) => call.toolName === "getNextAppointment"
  );
  if (calls.length !== 1) {
    failures.push(
      `expected exactly one getNextAppointment (next-patient prompt), got ${calls.length}`
    );
    return;
  }
  const encounterSteps = run.toolCalls
    .filter((call) => call.toolName === "createEncounter")
    .map((call) => call.step);
  if (
    encounterSteps.length > 0 &&
    calls[0].step <= Math.max(...encounterSteps)
  ) {
    failures.push(
      "getNextAppointment ran at/before the createEncounter step — the next-patient prompt comes after the visit is charted"
    );
  }
}

// Every NPI the (stubbed) provider search returned across the run — the pool a
// referral is allowed to draw its `referToProvider.npi` from. Invented NPIs aren't in
// it, which is the whole point of the provenance check below.
function searchedNpis(run: ScribeRun): Set<string> {
  const npis = new Set<string>();
  for (const result of run.toolResults) {
    if (result.toolName !== PROVIDER_SEARCH_TOOL_NAME) {
      continue;
    }
    const results = (result.output as { results?: unknown } | null)?.results;
    if (Array.isArray(results)) {
      for (const provider of results) {
        const npi = (provider as { npi?: unknown })?.npi;
        if (typeof npi === "string") {
          npis.add(npi);
        }
      }
    }
  }
  return npis;
}

// Provider-search argument hygiene (providerSearchPrompt + scribePrompt step
// 7): the model must not send params the NPI Registry validator rejects.
// Every string arg must be non-empty (the model omits or nulls what it doesn't
// know, never passing `""`); a wildcard `*` completes a partial value and needs
// at least two leading literal characters, so a bare `*` or `M*` is invalid;
// and `state`, if given, is at least two characters. Runs only when the model
// searched at all (referral cases), so non-referral cases are unaffected.
function checkProviderSearchArgs(run: ScribeRun, failures: string[]) {
  const searchCalls = run.toolCalls.filter(
    (call) => call.toolName === PROVIDER_SEARCH_TOOL_NAME
  );
  for (const call of searchCalls) {
    for (const [key, value] of Object.entries(call.input)) {
      if (typeof value !== "string") {
        continue;
      }
      if (value === "") {
        failures.push(
          `search_individual_providers passed an empty string for "${key}" — omit the param or pass null instead`
        );
        continue;
      }
      const starIndex = value.indexOf("*");
      if (starIndex >= 0 && starIndex < 2) {
        failures.push(
          `search_individual_providers "${key}" is "${value}" — a wildcard needs at least two leading characters (e.g. "Mul*"), never a bare or single-character "*"`
        );
      }
      if (key === "state" && value.length < 2) {
        failures.push(
          `search_individual_providers state "${value}" is under two characters, which the validator rejects`
        );
      }
    }
  }
}

// Per-case expectation for how a referred-to provider's name was split into
// `search_individual_providers` params (cases.ts `expectedProviderSearch`) —
// chiefly that a surname lands in `last_name`, not `first_name`. Each matcher
// needs SOME search call to satisfy it; extra searches are allowed (the model
// may search by name then refine). Runs only when the case declares
// expectations, so non-referral cases are unaffected.
function checkProviderSearches(
  evalCase: ScribeEvalCase,
  run: ScribeRun,
  failures: string[]
) {
  const expected = evalCase.expectedProviderSearch ?? [];
  if (expected.length === 0) {
    return;
  }
  const searchCalls = run.toolCalls.filter(
    (call) => call.toolName === PROVIDER_SEARCH_TOOL_NAME
  );
  for (const matcher of expected) {
    let nearest: string[] | null = null;
    const hit = searchCalls.some((call) => {
      const reasons = matcher.match(call.input);
      if (reasons.length === 0) {
        return true;
      }
      nearest ??= reasons;
      return false;
    });
    if (!hit) {
      const detail = nearest
        ? ` (nearest search rejected it: ${(nearest as string[]).join("; ")})`
        : " (no search_individual_providers call was made)";
      failures.push(
        `expected provider search missing: ${matcher.label}${detail}`
      );
    }
  }
}

// Protocol step 7: referrals discussed in the visit are filed with
// `sendReferral` AFTER the encounter and BEFORE the visit-summary message, all
// in ONE approval wave, each carrying an NPI first looked up with
// `search_individual_providers` (never invented). A case with no expected
// referral must produce none — an unprompted referral is over-charting.
function checkReferrals(
  evalCase: ScribeEvalCase,
  run: ScribeRun,
  failures: string[],
  warnings: string[]
) {
  const referrals = run.toolCalls.filter(
    (call) => call.toolName === "sendReferral"
  );
  const expected: ReferralMatcher[] = evalCase.expectedReferrals ?? [];

  if (expected.length === 0) {
    if (referrals.length > 0) {
      failures.push(
        `sendReferral was called ${referrals.length}× but no referral was discussed in this visit`
      );
    }
    return;
  }

  // Match each referral call to an expected referral; unmatched calls are
  // over-referring, unmatched expectations are missing referrals.
  const unconsumed = [...expected];
  for (const call of referrals) {
    let mismatchReasons: string[] | null = null;
    const index = unconsumed.findIndex((matcher) => {
      const reasons = matcher.match(call.input);
      if (reasons.length === 0) {
        return true;
      }
      mismatchReasons ??= reasons;
      return false;
    });
    if (index >= 0) {
      unconsumed.splice(index, 1);
    } else {
      const detail = mismatchReasons
        ? ` (nearest matcher rejected it: ${(mismatchReasons as string[]).join("; ")})`
        : "";
      failures.push(
        `unexpected referral sendReferral(${JSON.stringify(call.input).slice(0, 160)})${detail}`
      );
    }
  }
  for (const matcher of unconsumed) {
    failures.push(`required referral missing: ${matcher.label}`);
  }

  // Provenance: a referral's NPI must come from a provider search — the model
  // must look the provider up, not fabricate a plausible-looking number.
  const pool = searchedNpis(run);
  const searchCalls = run.toolCalls.filter(
    (call) => call.toolName === PROVIDER_SEARCH_TOOL_NAME
  );
  if (searchCalls.length === 0 && referrals.length > 0) {
    failures.push(
      "a referral was filed but search_individual_providers was never called to find the provider's NPI"
    );
  }
  for (const call of referrals) {
    const npi = String(
      (call.input.referToProvider as { npi?: unknown })?.npi ?? ""
    );
    if (!/^\d{10}$/.test(npi)) {
      failures.push(
        `referToProvider.npi "${npi}" is not a 10-digit NPI (from search_individual_providers)`
      );
    } else if (pool.size > 0 && !pool.has(npi)) {
      failures.push(
        `referToProvider.npi ${npi} was not returned by any search_individual_providers call — the NPI must be looked up, not invented`
      );
    }
  }

  if (referrals.length === 0) {
    return;
  }

  // Batching is a hard check: all referrals must go out in ONE approval wave
  // so the clinician isn't flooded with cards.
  const referralSteps = [...new Set(referrals.map((call) => call.step))];
  if (referralSteps.length > 1) {
    failures.push(
      `sendReferral calls span steps ${referralSteps.join(", ")} — all referrals must go out together in ONE approval wave`
    );
  }
  const minReferralStep = Math.min(...referralSteps);

  // The NPI lookup must precede the referral that uses it — a hard ordering
  // constraint (you can't copy an NPI you haven't fetched).
  if (
    searchCalls.length > 0 &&
    Math.min(...searchCalls.map((call) => call.step)) >= minReferralStep
  ) {
    failures.push(
      "search_individual_providers ran at/after sendReferral — the NPI lookup must come first"
    );
  }

  // Placement relative to the encounter and the visit summary follows the
  // prompt's step order (encounter → referrals → summary), but neither is
  // clinically load-bearing and live models reorder them freely, so these only
  // warn.
  const encounterSteps = run.toolCalls
    .filter((call) => call.toolName === "createEncounter")
    .map((call) => call.step);
  if (
    encounterSteps.length > 0 &&
    minReferralStep <= Math.max(...encounterSteps)
  ) {
    warnings.push(
      "sendReferral ran at/before createEncounter — the prompt files referrals after the encounter"
    );
  }
  const messageSteps = run.toolCalls
    .filter((call) => call.toolName === "sendMessage")
    .map((call) => call.step);
  if (messageSteps.length > 0 && minReferralStep >= Math.min(...messageSteps)) {
    warnings.push(
      "sendReferral ran at/after the visit-summary sendMessage — the prompt files the referral first so the summary can mention it"
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

  // Step 7: the visit-summary sendMessage is its own approval wave — alone in
  // its step, and strictly after the encounter is filed.
  const messageSteps = stepsOf(new Set(["sendMessage"]));
  for (const messageStep of messageSteps) {
    const sharing = run.toolCalls.filter(
      (call) => call.step === messageStep && call.toolName !== "sendMessage"
    );
    if (sharing.length > 0) {
      failures.push(
        `sendMessage (step ${messageStep}) shares its step with ${sharing.map((call) => call.toolName).join(", ")} — the summary message must be sent ALONE`
      );
    }
  }
  if (
    messageSteps.length > 0 &&
    encounterSteps.length > 0 &&
    Math.min(...messageSteps) <= Math.max(...encounterSteps)
  ) {
    failures.push(
      "sendMessage ran at/before the createEncounter step — the visit summary must be sent after the encounter is filed"
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
  checkPortalMessage(evalCase, run, failures);
  checkProviderSearchArgs(run, failures);
  checkProviderSearches(evalCase, run, failures);
  checkReferrals(evalCase, run, failures, warnings);
  checkNextAppointment(run, failures);
  checkFollowUpScheduling(evalCase, run, failures, warnings);
  checkWriteStaging(run, failures);

  if (!run.text.trim()) {
    failures.push("the run produced no closing text summary");
  }

  return { pass: failures.length === 0, failures, warnings };
}
