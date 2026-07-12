import {
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";
import {
  filterUpcomingAppointments,
  type LatestVitals,
  type MedicalIssueSummary,
  pickLatestVitals,
  toMedicalIssueSummary,
} from "@/lib/openemr/summaries";
import type {
  Appointment,
  Encounter,
  MedicalIssue,
  OpenEmrResponse,
  SoapNote,
  Vital,
} from "@/lib/openemr/types";

/** A section either resolved or failed independently of its siblings. */
export type Section<T> = { data: T } | { error: true };

/** Same enrichment as the getEncounters tool; null means the encounter has
 * no SOAP note (or its probe failed). */
export type OverviewEncounter = Encounter & { soapNote: SoapNote | null };

export type PatientOverviewResponse = {
  problems: Section<MedicalIssueSummary[]>;
  medications: Section<MedicalIssueSummary[]>;
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

// Only the most recent encounters are returned (with their SOAP notes) and
// probed for vitals — each per-encounter probe is a round trip to OpenEMR,
// and recent activity is what an overview needs.
const ENCOUNTERS_LIMIT = 6;
const VITALS_PROBE_ENCOUNTERS = 3;

// medical_problem/allergy are served by uuid-keyed controllers that wrap
// rows in a `{data}` envelope (and return an empty array, not a 404, when
// the patient has no entries) — unlike the legacy pid lists below.
async function fetchUuidIssueList(uuid: string, path: string) {
  const response = await openemrFetch<OpenEmrResponse<MedicalIssue[]>>(
    `/api/patient/${encodeURIComponent(uuid)}/${path}`
  );
  return response.data.map(toMedicalIssueSummary);
}

// medication/surgery are served by OpenEMR's legacy ListRestController: keyed
// by numeric pid, bare array (no `{data}` envelope), and a 404 with a null
// body when the patient has no entries — so a 404 means an empty list.
async function fetchLegacyIssueList(pid: string, path: string) {
  try {
    const response = await openemrFetch<MedicalIssue[] | null>(
      `/api/patient/${encodeURIComponent(pid)}/${path}`
    );
    return (response ?? []).map(toMedicalIssueSummary);
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
      sorted
        .slice(0, VITALS_PROBE_ENCOUNTERS)
        .map((encounter) =>
          openemrFetch<Vital[]>(
            `/api/patient/${encodeURIComponent(pid)}/encounter/${encodeURIComponent(String(encounter.eid))}/vital`
          ).catch(() => [] as Vital[])
        )
    ),
  ]);

  const encounters: OverviewEncounter[] = recent.map((encounter, index) => ({
    ...encounter,
    soapNote: soapNoteLists[index][0] ?? null,
  }));

  return {
    encounters,
    total: sorted.length,
    latestVitals: pickLatestVitals(vitalLists),
  };
}

async function fetchUpcomingAppointments(pid: string) {
  const response = await openemrFetch<Appointment[]>(
    `/api/patient/${encodeURIComponent(pid)}/appointment`
  );
  const today = new Date().toISOString().slice(0, 10);
  return filterUpcomingAppointments(response, today);
}

function toSection<T>(result: PromiseSettledResult<T>): Section<T> {
  return result.status === "fulfilled"
    ? { data: result.value }
    : { error: true };
}

// Aggregate a patient's chart for the patient-overview artifact.
// GET /api/openemr/patient-overview?uuid=<patient uuid>&pid=<patient pid>
//
// Sections degrade individually: one flaky endpoint returns `{error: true}`
// for its section while the rest of the chart still renders. The exception is
// a missing OpenEMR connection, which would fail every section identically
// and so becomes a whole-request 401.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uuid = searchParams.get("uuid");
  const pid = searchParams.get("pid");

  if (!(uuid && pid)) {
    return Response.json({ error: "missing_params" }, { status: 400 });
  }

  const [
    problems,
    medications,
    surgeries,
    allergies,
    encountersAndVitals,
    appointments,
  ] = await Promise.allSettled([
    fetchUuidIssueList(uuid, "medical_problem"),
    fetchLegacyIssueList(pid, "medication"),
    fetchLegacyIssueList(pid, "surgery"),
    fetchUuidIssueList(uuid, "allergy"),
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
  if (
    settled.some(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof OpenEmrNotConnectedError
    )
  ) {
    return Response.json(
      { error: "not_connected_to_openemr" },
      { status: 401 }
    );
  }

  const overview: PatientOverviewResponse = {
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

  return Response.json(overview);
}
