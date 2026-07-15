import type { PatientOverviewPayload } from "@/artifacts/patient-overview/client";
import type { UIArtifact } from "@/components/chat/artifact";
import type { PatientSummary } from "@/lib/openemr/summaries";

// The artifact state that opens a patient's overview chart in the side panel.
// Shared by every "open chart" click target (patient cards, appointment rows,
// the scribe recording panel). The overview route needs both the uuid
// (envelope endpoints) and the numeric pid (legacy endpoints); everything else
// in the payload may be sparse — the chart is fetched fresh, and name/DOB just
// pre-fill the demographics header.
export function patientOverviewArtifact(
  patient: PatientSummary,
  boundingBox: UIArtifact["boundingBox"]
): UIArtifact {
  const payload: PatientOverviewPayload = { patient };
  return {
    // Synthetic id — never looked up in the Document table; it namespaces
    // the artifact's SWR metadata cache, like the soap kind's.
    documentId: `patient-overview:${patient.uuid ?? patient.pid}`,
    kind: "patient-overview",
    content: JSON.stringify(payload),
    title: patient.name ? `Chart · ${patient.name}` : "Patient Overview",
    isVisible: true,
    status: "idle",
    boundingBox,
  };
}

// Fill a PatientSummary from just the identifying fields (e.g. an appointment
// join or a scribe selection) — the overview fetches the rest.
export function toSparsePatientSummary({
  uuid,
  pid,
  name,
  DOB = "",
}: {
  uuid: string;
  pid: number;
  name: string;
  DOB?: string;
}): PatientSummary {
  return {
    uuid,
    pid,
    name,
    DOB,
    pubpid: "",
    sex: "",
    status: "",
    phone: "",
    email: "",
    city: "",
    state: "",
  };
}
