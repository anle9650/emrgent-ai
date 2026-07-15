import type { PatientSummary } from "@/lib/openemr/summaries";
import type { Appointment } from "@/lib/openemr/types";

// Shared contract of the scribe flow: the selection the picker hands off, and
// the kickoff message format. The header/marker strings are load-bearing —
// `scribePrompt` (lib/ai/prompts.ts) tells the model how to react to them,
// the mock model (lib/ai/models.mock.ts) triggers on the header, and
// message rendering collapses the transcript below the marker.

export const SCRIBE_SESSION_HEADER = "Scribe session for patient";
export const SCRIBE_TRANSCRIPT_MARKER = "### Encounter transcript";

// Mirrors `patientRefSchema` in lib/ai/tools/openemr.ts — the identifiers
// every downstream patient tool keys off.
export type ScribePatientRef = {
  uuid: string;
  pid: number;
  name: string;
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
  patient: Pick<PatientSummary, "uuid" | "pid" | "name">
): ScribeSelection {
  return {
    patient: {
      uuid: patient.uuid,
      pid: patient.pid,
      name: patient.name,
    },
  };
}

export function buildScribeKickoffMessage({
  patient,
  appointment,
  transcript,
}: ScribeSelection & { transcript: string }): string {
  const lines = [
    `${SCRIBE_SESSION_HEADER} ${patient.name} (uuid: ${patient.uuid}, pid: ${patient.pid}).`,
  ];
  if (appointment) {
    lines.push(
      `Appointment: ${appointment.pc_title || "Appointment"} on ${appointment.pc_eventDate} at ${appointment.pc_startTime}.`
    );
  }
  lines.push(
    "",
    "Process the recorded encounter transcript below: update this patient's medical problems and medications, and create a new encounter with vitals and a SOAP note.",
    "",
    SCRIBE_TRANSCRIPT_MARKER,
    "",
    transcript.trim()
  );
  return lines.join("\n");
}
