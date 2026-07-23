import { format } from "date-fns";
// Type-only: lib/openemr/patient-overview imports server-only modules, but
// erased type imports keep this module client-safe.
import type {
  PatientOverviewResponse,
  Section,
} from "@/lib/openemr/patient-overview";
import type { PatientSummary } from "@/lib/openemr/summaries";
import type { Appointment } from "@/lib/openemr/types";
import { parseDateSafe } from "@/lib/utils";

// Shared contract of the scribe flow: the selection the picker hands off, and
// the kickoff message format. The header/marker strings are load-bearing —
// `scribePrompt` (lib/ai/prompts.ts) tells the model how to react to them,
// the mock model (lib/ai/models.mock.ts) triggers on the header and parses
// the prior-chart block, and message rendering collapses the transcript
// below the marker.

export const SCRIBE_SESSION_HEADER = "Scribe session for patient";
export const SCRIBE_TRANSCRIPT_MARKER = "### Encounter transcript";
export const SCRIBE_PRIOR_CHART_MARKER = "### Prior chart";

// `uuid`, `pid`, and `name` mirror `patientRefSchema` in
// lib/ai/tools/openemr.ts — the identifiers every downstream patient tool
// keys off, and all the kickoff message needs. DOB/sex/pubpid are carried
// for display only (the overview chart's demographics header fetches its
// own record and ignores them); they're optional because the appointment
// join supplies only DOB, while patient search supplies all three.
export type ScribePatientRef = {
  uuid: string;
  pid: number;
  name: string;
  DOB?: string;
  sex?: string;
  pubpid?: string;
};

export type ScribeAppointmentRef = {
  pc_eid: string;
  pc_title: string;
  pc_eventDate: string;
  pc_startTime: string;
};

export type ScribeSelection = {
  patient: ScribePatientRef;
  appointment?: ScribeAppointmentRef;
};

export function selectionFromAppointment(
  appointment: Appointment
): ScribeSelection {
  return {
    patient: {
      uuid: appointment.puuid,
      pid: Number(appointment.pid),
      name: [appointment.fname, appointment.lname].filter(Boolean).join(" "),
      // The calendar join carries DOB but not sex/pubpid.
      DOB: appointment.DOB,
    },
    appointment: {
      pc_eid: appointment.pc_eid,
      pc_title: appointment.pc_title,
      pc_eventDate: appointment.pc_eventDate,
      pc_startTime: appointment.pc_startTime,
    },
  };
}

export function selectionFromPatient(
  patient: Pick<
    PatientSummary,
    "uuid" | "pid" | "name" | "DOB" | "sex" | "pubpid"
  >
): ScribeSelection {
  return {
    patient: {
      uuid: patient.uuid,
      pid: patient.pid,
      name: patient.name,
      DOB: patient.DOB,
      sex: patient.sex,
      pubpid: patient.pubpid,
    },
  };
}

/** The chart sections the kickoff's prior-chart block carries — the
 * scribe-relevant subset of the patient-overview aggregation. */
export type ScribePriorChartSections = Pick<
  PatientOverviewResponse,
  "problems" | "medications" | "surgeries" | "allergies" | "encounters"
>;

// The markers are structural: parseScribeKickoff locates them with indexOf,
// so a serialized chart value containing one (e.g. a prior SOAP note quoting
// a kickoff) would truncate parsing. Strip the "### " prefix so the text
// survives without acting as a marker.
function scrubMarkers(serialized: string): string {
  return serialized
    .replaceAll(SCRIBE_TRANSCRIPT_MARKER, "Encounter transcript")
    .replaceAll(SCRIBE_PRIOR_CHART_MARKER, "Prior chart");
}

// `[]` (an empty section) means "none on file" — a fact, not a gap; only an
// errored fetch tells the model to fall back to the read tool.
function sectionLine<T>(section: Section<T[]>, fallbackTool: string | null) {
  if ("error" in section) {
    return fallbackTool
      ? `Unavailable — call ${fallbackTool} to fetch.`
      : "Unavailable.";
  }
  return scrubMarkers(JSON.stringify(section.data));
}

/**
 * Serialize the prefetched chart into the kickoff's "### Prior chart" block.
 * Each section is one header line plus ONE line of compact JSON (the same
 * shapes the read tools return, so reconciliation writes can copy
 * `uuid`/`id` fields verbatim) — single-line values keep the kickoff's
 * anchored header regexes and the mock model's line-based parse
 * (lib/ai/models.mock.ts scribeChunks) collision-free.
 */
export function buildScribePriorChart(
  sections: ScribePriorChartSections
): string {
  const lines = [
    SCRIBE_PRIOR_CHART_MARKER,
    "Prefetched from OpenEMR at kickoff. This reflects the chart BEFORE this visit; chart writes made in this conversation supersede it.",
    "",
    "#### Medical problems",
    sectionLine(sections.problems, "getMedicalProblems"),
    "#### Medications",
    sectionLine(sections.medications, "getMedications"),
    "#### Surgeries",
    sectionLine(sections.surgeries, "getSurgeries"),
    "#### Allergies",
    // No read tool serves allergies — the block is their only source.
    sectionLine(sections.allergies, null),
  ];
  const encounters = sections.encounters;
  if ("error" in encounters) {
    lines.push(
      "#### Recent encounters",
      "Unavailable — call getEncounters to fetch."
    );
  } else {
    lines.push(
      `#### Recent encounters (showing ${encounters.data.items.length} of ${encounters.data.total}, newest first)`,
      scrubMarkers(JSON.stringify(encounters.data.items))
    );
  }
  return lines.join("\n");
}

export function buildScribeKickoffMessage({
  patient,
  appointment,
  transcript,
  visitDate,
  visitTime,
  priorChart,
}: ScribeSelection & {
  transcript: string;
  /** The encounter date (YYYY-MM-DD), stamped at recording time so the note
   * shows the real visit date even when reopened later. */
  visitDate: string;
  /** The encounter time (HH:mm), stamped alongside the date. */
  visitTime: string;
  /** The prefetched chart; absent when the prefetch failed — the model then
   * falls back to the context-read tools per scribePrompt. */
  priorChart?: ScribePriorChartSections | null;
}): string {
  const lines = [
    `${SCRIBE_SESSION_HEADER} ${patient.name} (uuid: ${patient.uuid}, pid: ${patient.pid}).`,
    `Visit date: ${visitDate}.`,
    `Visit time: ${visitTime}.`,
  ];
  // Demographics travel with the message for display (the kickoff card and
  // the model's context) — the overview chart header fetches its own record.
  // The appointment join carries only DOB; patient search carries both.
  if (patient.DOB) {
    lines.push(`DOB: ${patient.DOB}.`);
  }
  if (patient.sex) {
    lines.push(`Sex: ${patient.sex}.`);
  }
  if (appointment) {
    lines.push(
      `Appointment: ${appointment.pc_title || "Appointment"} on ${appointment.pc_eventDate} at ${appointment.pc_startTime}.`
    );
    // Machine line: the appointment's calendar id, kept in the header so it
    // survives on the persisted message (the client's only durable source) and
    // can never be spoofed by transcript speech. Powers the ViewChartCard's
    // Check Out action; the model never sees or handles it.
    lines.push(`Appointment ref: eid=${appointment.pc_eid}.`);
  }
  lines.push(
    "",
    "Process the recorded encounter transcript below: update this patient's medical problems, medications, and surgeries, and create a new encounter with vitals and a SOAP note."
  );
  // The block sits between the instruction and the transcript marker: never
  // rendered by the kickoff card (which shows header fields + collapsed
  // transcript only), but persisted with the message so follow-up turns keep
  // the context.
  if (priorChart) {
    lines.push("", buildScribePriorChart(priorChart));
  }
  lines.push("", SCRIBE_TRANSCRIPT_MARKER, "", transcript.trim());
  return lines.join("\n");
}

export type ParsedScribeKickoff = {
  patientName: string;
  uuid: string | null;
  pid: number | null;
  DOB: string | null;
  sex: string | null;
  visitDate: string | null;
  /** HH:mm; null for messages saved before the time was baked in. */
  visitTime: string | null;
  appointmentTitle: string | null;
  /** The linked appointment's OpenEMR calendar id (`pc_eid`), or null when the
   * session wasn't started from an appointment. Recovered from the machine
   * "Appointment ref: eid=…" header line. */
  appointmentEid: string | null;
  transcript: string;
};

// Recover the display fields from a persisted kickoff message. Co-located with
// `buildScribeKickoffMessage` so the two stay in sync — the message text is
// the card's only source of truth on reload. The instruction line is left out
// (it's for the model), but uuid/pid/DOB/sex are recovered so the card can
// identify the patient and open their overview chart. Fields are matched
// against the header section only, so transcript content (which is ambient
// speech) can never spoof them.
export function parseScribeKickoff(text: string): ParsedScribeKickoff {
  const markerIndex = text.indexOf(SCRIBE_TRANSCRIPT_MARKER);
  // The header ends at whichever marker comes first — the prior-chart block
  // precedes the transcript, and its serialized chart values must never be
  // scanned by the header field regexes below.
  const headerEnd = [text.indexOf(SCRIBE_PRIOR_CHART_MARKER), markerIndex]
    .filter((index) => index !== -1)
    .reduce((a, b) => Math.min(a, b), text.length);
  const header = text.slice(0, headerEnd);
  const transcript =
    markerIndex === -1
      ? ""
      : text.slice(markerIndex + SCRIBE_TRANSCRIPT_MARKER.length).trim();

  const patientMatch = header.match(
    /Scribe session for patient (.+?) \(uuid: ([0-9a-f-]+), pid: (\d+)\)/
  );
  const visitDateMatch = header.match(/^Visit date: (\d{4}-\d{2}-\d{2})\.$/m);
  const visitTimeMatch = header.match(/^Visit time: (\d{2}:\d{2})\.$/m);
  const dobMatch = header.match(/^DOB: (\d{4}-\d{2}-\d{2})\.$/m);
  const sexMatch = header.match(/^Sex: (.+?)\.$/m);
  const appointmentMatch = header.match(/^Appointment: (.+?) on /m);
  const appointmentEidMatch = header.match(/^Appointment ref: eid=(.+?)\.$/m);

  return {
    patientName: patientMatch?.[1] ?? "",
    uuid: patientMatch?.[2] ?? null,
    pid: patientMatch ? Number(patientMatch[3]) : null,
    DOB: dobMatch?.[1] ?? null,
    sex: sexMatch?.[1] ?? null,
    visitDate: visitDateMatch?.[1] ?? null,
    visitTime: visitTimeMatch?.[1] ?? null,
    appointmentTitle: appointmentMatch?.[1] ?? null,
    appointmentEid: appointmentEidMatch?.[1] ?? null,
    transcript,
  };
}

/** The kickoff's "### Prior chart" block (markers included), or null when the
 * kickoff carries none — used by the eval graders to reconstruct the chart
 * exactly as the scribe saw it. */
export function scribePriorChartBlockOf(kickoffText: string): string | null {
  const start = kickoffText.indexOf(SCRIBE_PRIOR_CHART_MARKER);
  if (start === -1) {
    return null;
  }
  const end = kickoffText.indexOf(SCRIBE_TRANSCRIPT_MARKER, start);
  return (
    end === -1 ? kickoffText.slice(start) : kickoffText.slice(start, end)
  ).trim();
}

// Scribe chats get a deterministic title — patient name plus visit date,
// rendered like the kickoff card ("Eleanor Vance · Jul 15, 2026") — instead
// of an LLM-generated one. Returns null when the message isn't a parseable
// kickoff, so the caller can fall back to the generated title. The kickoff's
// visit time stays out of the title (and the card); it travels in the
// message for the model's benefit.
export function scribeChatTitle(kickoffText: string): string | null {
  const { patientName, visitDate } = parseScribeKickoff(kickoffText);
  if (!patientName) {
    return null;
  }
  const parsedDate = visitDate ? parseDateSafe(visitDate) : null;
  const dateLabel = parsedDate ? format(parsedDate, "MMM d, yyyy") : visitDate;
  return dateLabel ? `${patientName} · ${dateLabel}` : patientName;
}

// A tool part is "settled" once it reaches one of these terminal states; any
// other state means the agent is still mid-loop or waiting on the user (e.g.
// an approval), so the turn isn't finished.
export const TERMINAL_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

// Structural subset of a chat message — kept minimal so this stays a pure,
// React-free helper the unit tests can exercise directly.
type ChartStateMessage = {
  role: string;
  parts?: Record<string, unknown>[];
};

export type ScribeChartState = {
  /** Identifiers plus whichever demographics the kickoff carries (DOB/sex)
   * — display-only; the opened chart header fetches its own record. */
  patient: {
    uuid: string;
    pid: number;
    name: string;
    DOB?: string;
    sex?: string;
  };
  /** toolCallIds of createEncounter calls that have completed successfully. */
  completedEncounterIds: string[];
  /** True while any tool call is still awaiting approval or execution — i.e.
   * the agent's turn has NOT finished, regardless of call order. */
  hasPendingTool: boolean;
};

// Read a scribe chat's charting state: the patient ref, which createEncounter
// writes have landed, and whether the agent is still working. The auto-open
// hook combines a settled turn (no pending tools) with a completed encounter
// to detect "the visit has been scribed" — this does NOT assume createEncounter
// is the last call. Returns null for non-scribe chats (first user message must
// be a kickoff carrying uuid + pid).
export function readScribeChartState(
  messages: ChartStateMessage[]
): ScribeChartState | null {
  const firstUser = messages.find((message) => message.role === "user");
  const kickoffText = firstUser?.parts?.find(
    (part) => part.type === "text"
  )?.text;
  if (
    typeof kickoffText !== "string" ||
    !kickoffText.includes(SCRIBE_SESSION_HEADER)
  ) {
    return null;
  }
  const { uuid, pid, patientName, DOB, sex } = parseScribeKickoff(kickoffText);
  if (uuid === null || pid === null) {
    return null;
  }

  const completedEncounterIds: string[] = [];
  let hasPendingTool = false;
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts ?? []) {
      const type = part.type;
      if (typeof type !== "string" || !type.startsWith("tool-")) {
        continue;
      }
      const state = part.state;
      if (typeof state !== "string" || !TERMINAL_TOOL_STATES.has(state)) {
        hasPendingTool = true;
        continue;
      }
      const output = part.output;
      if (
        type === "tool-createEncounter" &&
        state === "output-available" &&
        typeof output === "object" &&
        output !== null &&
        !("error" in output) &&
        typeof part.toolCallId === "string"
      ) {
        completedEncounterIds.push(part.toolCallId);
      }
    }
  }

  return {
    patient: {
      uuid,
      pid,
      name: patientName,
      DOB: DOB ?? undefined,
      sex: sex ?? undefined,
    },
    completedEncounterIds,
    hasPendingTool,
  };
}

/** The ViewChartCard's charting receipt: how many chart writes of each kind
 * have landed. `encounterFiled` stands in for the visit note — one encounter
 * carries the SOAP note. */
export type ScribeChartWrites = {
  problems: number;
  medications: number;
  surgeries: number;
  encounterFiled: boolean;
};

const WRITE_TOOL_SECTIONS: Record<
  string,
  Exclude<keyof ScribeChartWrites, "encounterFiled">
> = {
  "tool-createMedicalProblem": "problems",
  "tool-updateMedicalProblem": "problems",
  "tool-createMedication": "medications",
  "tool-updateMedication": "medications",
  "tool-createSurgery": "surgeries",
};

// Tally the conversation's successful chart writes from its tool parts —
// pending, denied, and errored calls don't count. Pure and React-free like
// readScribeChartState; the a2ui tool-source map's values feed it directly.
export function summarizeScribeChartWrites(
  parts: Iterable<Record<string, unknown>>
): ScribeChartWrites {
  const writes: ScribeChartWrites = {
    problems: 0,
    medications: 0,
    surgeries: 0,
    encounterFiled: false,
  };
  for (const part of parts) {
    const { type, state, output } = part;
    if (
      typeof type !== "string" ||
      state !== "output-available" ||
      typeof output !== "object" ||
      output === null ||
      "error" in output
    ) {
      continue;
    }
    if (type === "tool-createEncounter") {
      writes.encounterFiled = true;
      continue;
    }
    const section = WRITE_TOOL_SECTIONS[type];
    if (section) {
      writes[section] += 1;
    }
  }
  return writes;
}
