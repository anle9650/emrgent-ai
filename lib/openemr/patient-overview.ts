import {
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";
import {
  filterUpcomingAppointments,
  type LatestVitals,
  type MedicalIssueSummary,
  type MedicalProblemSummary,
  type MedicationSummary,
  pickLatestVitals,
  toMedicalIssueSummary,
  toMedicalProblemSummary,
  toMedicationSummary,
  toVitalSummary,
  type VitalSummary,
} from "@/lib/openemr/summaries";
import type {
  Appointment,
  Encounter,
  MedicalIssue,
  OpenEmrResponse,
  SoapNote,
  Vital,
} from "@/lib/openemr/types";

// Aggregates a patient's chart in one call — used by the patient-overview
// proxy route (feeding the overview artifact) and by the scribe kickoff
// prefetch. Problems and medications keep their `uuid`/`id` because the
// scribe's reconciliation writes (updateMedicalProblem/updateMedication)
// address rows by them.

/** A section either resolved or failed independently of its siblings. */
export type Section<T> = { data: T } | { error: true };

/** Same enrichment as the getEncounters tool; null means the encounter has
 * no SOAP note / vitals (or the probe failed). */
export type OverviewEncounter = Encounter & {
  soapNote: SoapNote | null;
  vitals: VitalSummary | null;
};

export type PatientOverviewResponse = {
  problems: Section<MedicalProblemSummary[]>;
  medications: Section<MedicationSummary[]>;
  surgeries: Section<MedicalIssueSummary[]>;
  /** Feeds the demographics allergy banner, not a chart section. */
  allergies: Section<MedicalIssueSummary[]>;
  /** The most recent encounters (up to ENCOUNTERS_LIMIT), newest first;
   * `total` is the patient's full encounter count. */
  encounters: Section<{ items: OverviewEncounter[]; total: number }>;
  vitals: Section<LatestVitals | null>;
  /** Upcoming only, soonest first. */
  appointments: Section<Appointment[]>;
};

// Only the most recent encounters are returned (with their SOAP notes and
// vitals) — each per-encounter probe is a round trip to OpenEMR, and recent
// activity is what an overview needs.
const ENCOUNTERS_LIMIT = 6;

// medical_problem/allergy are served by uuid-keyed controllers that wrap
// rows in a `{data}` envelope (and return an empty array, not a 404, when
// the patient has no entries) — unlike the legacy pid lists below.
async function fetchUuidIssueList<T>(
  uuid: string,
  path: string,
  toSummary: (issue: MedicalIssue) => T
) {
  const response = await openemrFetch<OpenEmrResponse<MedicalIssue[]>>(
    `/api/patient/${encodeURIComponent(uuid)}/${path}`
  );
  return response.data.map(toSummary);
}

// medication/surgery are served by OpenEMR's legacy ListRestController: keyed
// by numeric pid, bare array (no `{data}` envelope), and a 404 with a null
// body when the patient has no entries — so a 404 means an empty list.
async function fetchLegacyIssueList<T>(
  pid: string,
  path: string,
  toSummary: (issue: MedicalIssue) => T
) {
  try {
    const response = await openemrFetch<MedicalIssue[] | null>(
      `/api/patient/${encodeURIComponent(pid)}/${path}`
    );
    return (response ?? []).map(toSummary);
  } catch (error) {
    if (error instanceof OpenEmrApiError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

// Vitals have no patient-level endpoint — they hang off encounters — so both
// sections share one fetch chain (and fail together).
async function fetchEncountersAndVitals(uuid: string, pid: string) {
  const response = await openemrFetch<OpenEmrResponse<Encounter[]>>(
    `/api/patient/${encodeURIComponent(uuid)}/encounter`
  );
  const sorted = [...response.data].sort((a, b) =>
    b.date.localeCompare(a.date)
  );
  const recent = sorted.slice(0, ENCOUNTERS_LIMIT);

  const [soapNoteLists, vitalLists] = await Promise.all([
    Promise.all(
      recent.map((encounter) =>
        openemrFetch<SoapNote[]>(
          `/api/patient/${encodeURIComponent(pid)}/encounter/${encodeURIComponent(String(encounter.eid))}/soap_note`
        ).catch(() => [] as SoapNote[])
      )
    ),
    Promise.all(
      recent.map((encounter) =>
        openemrFetch<Vital[]>(
          `/api/patient/${encodeURIComponent(pid)}/encounter/${encodeURIComponent(String(encounter.eid))}/vital`
        ).catch(() => [] as Vital[])
      )
    ),
  ]);

  const encounters: OverviewEncounter[] = recent.map((encounter, index) => ({
    ...encounter,
    soapNote: soapNoteLists[index][0] ?? null,
    vitals: vitalLists[index][0] ? toVitalSummary(vitalLists[index][0]) : null,
  }));

  return {
    encounters,
    total: sorted.length,
    latestVitals: pickLatestVitals(vitalLists),
  };
}

// Like the legacy lists above, the appointment endpoint responds 404 with a
// null body when the patient has none — an empty schedule, not a failure.
async function fetchUpcomingAppointments(pid: string) {
  let response: Appointment[];
  try {
    response =
      (await openemrFetch<Appointment[] | null>(
        `/api/patient/${encodeURIComponent(pid)}/appointment`
      )) ?? [];
  } catch (error) {
    if (error instanceof OpenEmrApiError && error.status === 404) {
      response = [];
    } else {
      throw error;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  return filterUpcomingAppointments(response, today);
}

function toSection<T>(result: PromiseSettledResult<T>): Section<T> {
  return result.status === "fulfilled"
    ? { data: result.value }
    : { error: true };
}

/**
 * Aggregate a patient's chart. Sections degrade individually: one flaky
 * endpoint yields `{error: true}` for its section while the rest of the chart
 * still resolves. The exception is a missing OpenEMR connection, which would
 * fail every section identically — that `OpenEmrNotConnectedError` is
 * rethrown so callers can surface it whole (the route maps it to a 401).
 */
export async function fetchPatientOverview(
  uuid: string,
  pid: string
): Promise<PatientOverviewResponse> {
  const [
    problems,
    medications,
    surgeries,
    allergies,
    encountersAndVitals,
    appointments,
  ] = await Promise.allSettled([
    fetchUuidIssueList(uuid, "medical_problem", toMedicalProblemSummary),
    fetchLegacyIssueList(pid, "medication", toMedicationSummary),
    fetchLegacyIssueList(pid, "surgery", toMedicalIssueSummary),
    fetchUuidIssueList(uuid, "allergy", toMedicalIssueSummary),
    fetchEncountersAndVitals(uuid, pid),
    fetchUpcomingAppointments(pid),
  ]);

  const settled = [
    problems,
    medications,
    surgeries,
    allergies,
    encountersAndVitals,
    appointments,
  ];
  const notConnected = settled.find(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof OpenEmrNotConnectedError
  );
  if (notConnected?.status === "rejected") {
    throw notConnected.reason;
  }

  return {
    problems: toSection(problems),
    medications: toSection(medications),
    surgeries: toSection(surgeries),
    allergies: toSection(allergies),
    encounters:
      encountersAndVitals.status === "fulfilled"
        ? {
            data: {
              items: encountersAndVitals.value.encounters,
              total: encountersAndVitals.value.total,
            },
          }
        : { error: true },
    vitals:
      encountersAndVitals.status === "fulfilled"
        ? { data: encountersAndVitals.value.latestVitals }
        : { error: true },
    appointments: toSection(appointments),
  };
}
