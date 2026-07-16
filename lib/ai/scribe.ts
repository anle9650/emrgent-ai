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
