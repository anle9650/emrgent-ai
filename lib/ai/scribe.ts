import type { PatientSummary } from "@/lib/openemr/summaries";
import type { Appointment } from "@/lib/openemr/types";

// Shared contract of the scribe flow: the selection the picker hands off, and
// the kickoff message format. The header/marker strings are load-bearing —
// `scribePrompt` (lib/ai/prompts.ts) tells the model how to react to them,
// the mock model (lib/ai/models.mock.ts) triggers on the header, and
// message rendering collapses the transcript below the marker.

export const SCRIBE_SESSION_HEADER = "Scribe session for patient";
export const SCRIBE_TRANSCRIPT_MARKER = "### Encounter transcript";

// `uuid`, `pid`, and `name` mirror `patientRefSchema` in
// lib/ai/tools/openemr.ts — the identifiers every downstream patient tool
// keys off, and all the kickoff message needs. DOB/sex/pubpid are carried
// for display only (they pre-fill the overview chart's demographics header
// when "View chart" is clicked); they're optional because the appointment
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

export function buildScribeKickoffMessage({
  patient,
  appointment,
  transcript,
  visitDate,
}: ScribeSelection & {
  transcript: string;
  /** The encounter date (YYYY-MM-DD), stamped at recording time so the note
   * shows the real visit date even when reopened later. */
  visitDate: string;
}): string {
  const lines = [
    `${SCRIBE_SESSION_HEADER} ${patient.name} (uuid: ${patient.uuid}, pid: ${patient.pid}).`,
    `Visit date: ${visitDate}.`,
  ];
  if (appointment) {
    lines.push(
      `Appointment: ${appointment.pc_title || "Appointment"} on ${appointment.pc_eventDate} at ${appointment.pc_startTime}.`
    );
  }
  lines.push(
    "",
    "Process the recorded encounter transcript below: update this patient's medical problems, medications, and surgeries, and create a new encounter with vitals and a SOAP note.",
    "",
    SCRIBE_TRANSCRIPT_MARKER,
    "",
    transcript.trim()
  );
  return lines.join("\n");
}

export type ParsedScribeKickoff = {
  patientName: string;
  uuid: string | null;
  pid: number | null;
  visitDate: string | null;
  appointmentTitle: string | null;
  transcript: string;
};

// Recover the display fields from a persisted kickoff message. Co-located with
// `buildScribeKickoffMessage` so the two stay in sync — the message text is
// the card's only source of truth on reload. The instruction line is left out
// (it's for the model), but uuid/pid are recovered so the card can open the
// patient's overview chart.
export function parseScribeKickoff(text: string): ParsedScribeKickoff {
  const patientMatch = text.match(
    /Scribe session for patient (.+?) \(uuid: ([0-9a-f-]+), pid: (\d+)\)/
  );
  const visitDateMatch = text.match(/Visit date: (\d{4}-\d{2}-\d{2})/);
  const appointmentMatch = text.match(/Appointment: (.+?) on /);
  const markerIndex = text.indexOf(SCRIBE_TRANSCRIPT_MARKER);
  const transcript =
    markerIndex === -1
      ? ""
      : text.slice(markerIndex + SCRIBE_TRANSCRIPT_MARKER.length).trim();

  return {
    patientName: patientMatch?.[1] ?? "",
    uuid: patientMatch?.[2] ?? null,
    pid: patientMatch ? Number(patientMatch[3]) : null,
    visitDate: visitDateMatch?.[1] ?? null,
    appointmentTitle: appointmentMatch?.[1] ?? null,
    transcript,
  };
}

// A tool part is "settled" once it reaches one of these terminal states; any
// other state means the agent is still mid-loop or waiting on the user (e.g.
// an approval), so the turn isn't finished.
const TERMINAL_TOOL_STATES = new Set([
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
  patient: { uuid: string; pid: number; name: string };
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
  const { uuid, pid, patientName } = parseScribeKickoff(kickoffText);
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
    patient: { uuid, pid, name: patientName },
    completedEncounterIds,
    hasPendingTool,
  };
}
