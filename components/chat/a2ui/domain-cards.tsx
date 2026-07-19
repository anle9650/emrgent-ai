"use client";

import type { A2UIComponent } from "@/lib/ai/a2ui/schema";
import { summarizeScribeChartWrites } from "@/lib/ai/scribe";
import { AppointmentPicker } from "../appointment-picker";
import { Appointments } from "../appointments";
import { Encounters } from "../encounters";
import { MedicalIssues } from "../medical-issues";
import { Patients } from "../patients";
import { SoapNoteCard } from "../soap-note";
import { ViewChartCard } from "../view-chart-card";
import { UnavailableChip } from "./primitives";
import { useA2UIToolSources } from "./source-context";

type NodeOf<K extends A2UIComponent["component"]> = Extract<
  A2UIComponent,
  { component: K }
>;

// Adapters resolving `sourceToolCallId` to the referenced tool part and
// delegating to the existing bespoke cards — the surface never carries
// clinical values itself. Every unresolvable reference degrades to a chip.

export function A2UIPatientsCard({ node }: { node: NodeOf<"PatientsCard"> }) {
  const part = useA2UIToolSources().get(node.sourceToolCallId);
  if (
    part?.type !== "tool-searchPatients" ||
    part.state !== "output-available" ||
    "error" in part.output
  ) {
    return <UnavailableChip reason="patient search result unavailable" />;
  }
  const patients = node.uuids
    ? part.output.results.filter((patient) =>
        node.uuids?.includes(patient.uuid)
      )
    : part.output.results;
  return <Patients patients={patients} />;
}

export function A2UIEncountersCard({
  node,
}: {
  node: NodeOf<"EncountersCard">;
}) {
  const part = useA2UIToolSources().get(node.sourceToolCallId);
  if (
    part?.type !== "tool-getEncounters" ||
    part.state !== "output-available" ||
    "error" in part.output
  ) {
    return <UnavailableChip reason="encounter data unavailable" />;
  }
  const encounters = node.eids
    ? part.output.results.filter((encounter) =>
        node.eids?.includes(encounter.eid)
      )
    : part.output.results;
  return <Encounters encounters={encounters} />;
}

export function A2UIAppointmentsCard({
  node,
}: {
  node: NodeOf<"AppointmentsCard">;
}) {
  const part = useA2UIToolSources().get(node.sourceToolCallId);
  if (
    part?.type !== "tool-getAppointments" ||
    part.state !== "output-available" ||
    "error" in part.output
  ) {
    return <UnavailableChip reason="appointment data unavailable" />;
  }
  return <Appointments appointments={part.output.results} />;
}

// Action card, not a data render: the slots come from the source call's
// results, but the patient it books for comes from that call's
// `input.patient` — resolved from the source tool call, never restated by the
// model, so a picker can't be pointed at a different chart.
export function A2UIAppointmentPickerCard({
  node,
}: {
  node: NodeOf<"AppointmentPickerCard">;
}) {
  const part = useA2UIToolSources().get(node.sourceToolCallId);
  if (
    part?.type !== "tool-getAvailableAppointments" ||
    part.state !== "output-available" ||
    "error" in part.output
  ) {
    return <UnavailableChip reason="appointment availability unavailable" />;
  }
  return (
    <AppointmentPicker
      candidates={part.output.results}
      pid={part.input?.patient?.pid}
    />
  );
}

// The card's `kind` comes from the resolved tool part's type — never from the
// model — so a medication list can't be mislabeled as a problem list.
const ISSUE_KINDS = {
  "tool-getMedicalProblems": "problems",
  "tool-getMedications": "medications",
  "tool-getSurgeries": "surgeries",
} as const;

export function A2UIMedicalIssuesCard({
  node,
}: {
  node: NodeOf<"MedicalIssuesCard">;
}) {
  const part = useA2UIToolSources().get(node.sourceToolCallId);
  if (
    (part?.type === "tool-getMedicalProblems" ||
      part?.type === "tool-getMedications" ||
      part?.type === "tool-getSurgeries") &&
    part.state === "output-available" &&
    !("error" in part.output)
  ) {
    return (
      <MedicalIssues
        issues={part.output.results}
        kind={ISSUE_KINDS[part.type]}
      />
    );
  }
  return <UnavailableChip reason="medical issue data unavailable" />;
}

export function A2UISoapNoteCard({ node }: { node: NodeOf<"SoapNoteCard"> }) {
  const part = useA2UIToolSources().get(node.sourceToolCallId);
  if (
    part?.type !== "tool-getSoapNote" ||
    part.state !== "output-available" ||
    "error" in part.output
  ) {
    return <UnavailableChip reason="SOAP note unavailable" />;
  }
  return <SoapNoteCard eid={part.input?.eid} soapNote={part.output.results} />;
}

// Action card, not a data render: the patient ref comes from the source
// createEncounter call's `input.patient` (its output has no patient uuid/pid).
// The receipt row is tallied from the source map's full part set — write
// counts, not clinical values, so it stays inside the binding-tier rule.
export function A2UIViewChartCard({ node }: { node: NodeOf<"ViewChartCard"> }) {
  const sources = useA2UIToolSources();
  const part = sources.get(node.sourceToolCallId);
  if (
    part?.type !== "tool-createEncounter" ||
    part.state !== "output-available" ||
    "error" in part.output
  ) {
    return <UnavailableChip reason="chart unavailable" />;
  }
  return (
    <ViewChartCard
      patient={part.input.patient}
      writes={summarizeScribeChartWrites(sources.values())}
    />
  );
}
