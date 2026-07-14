import type {
  Appointment,
  MedicalIssue,
  Patient,
  Vital,
} from "@/lib/openemr/types";

// Pure massaging helpers shared by the AI tools (lib/ai/tools/openemr.ts) and
// the patient-overview proxy route. Keeping them out of the tools module lets
// server routes import them without pulling in the tool definitions, and lets
// client components import the derived types.

// Trim the ~150-field OpenEMR record down to what's useful for identifying and
// disambiguating a patient in search results. Keeps token cost low and avoids
// exposing PHI (SSN, license, guardian details, HIPAA flags) the model doesn't
// need. `uuid`/`pid` are retained because the encounter/SOAP tools key off them.
export type PatientSummary = ReturnType<typeof toPatientSummary>;

export function toPatientSummary(patient: Patient) {
  return {
    uuid: patient.uuid,
    pid: patient.pid,
    pubpid: patient.pubpid,
    name: [patient.title, patient.fname, patient.mname, patient.lname]
      .filter(Boolean)
      .join(" "),
    DOB: patient.DOB,
    sex: patient.sex,
    status: patient.status,
    phone: patient.phone_cell || patient.phone_home,
    email: patient.email,
    city: patient.city,
    state: patient.state,
  };
}

// OpenEMR serializes vitals measurements as decimal strings ("195.000000",
// "98.600000"); cast them to numbers (195, 98.6) — the padded precision is
// meaningless.
function toNumeric(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Trim the ~45-column vitals form down to the measurements themselves — ids,
// timestamps, and per-measurement `*_unit` columns are token noise the model
// doesn't need.
export type VitalSummary = ReturnType<typeof toVitalSummary>;

export function toVitalSummary(vital: Vital) {
  return {
    date: vital.date,
    bps: toNumeric(vital.bps),
    bpd: toNumeric(vital.bpd),
    weight: toNumeric(vital.weight),
    height: toNumeric(vital.height),
    temperature: toNumeric(vital.temperature),
    pulse: toNumeric(vital.pulse),
    respiration: toNumeric(vital.respiration),
    oxygen_saturation: toNumeric(vital.oxygen_saturation),
  };
}

// Flatten the two `diagnosis` shapes OpenEMR sends (raw "ICD10:E11.9" string
// from the legacy list endpoints, code-keyed coding object from the
// medical_problem endpoint) into one uniform list of codes.
function toDiagnosisCodes(diagnosis: MedicalIssue["diagnosis"]) {
  if (!diagnosis) {
    return [];
  }
  if (typeof diagnosis === "string") {
    return diagnosis
      .split(";")
      .filter(Boolean)
      .map((code) => ({ code, description: null as string | null }));
  }
  return Object.values(diagnosis).map((coding) => ({
    code: coding.code_type ? `${coding.code_type}:${coding.code}` : coding.code,
    description: coding.description || null,
  }));
}

// Trim a lists-table entry down to what identifies the issue and its status —
// ids, audit columns, and injury/allergy-specific fields are token noise.
// `active` is derived: an issue with no end date is still ongoing.
export type MedicalIssueSummary = ReturnType<typeof toMedicalIssueSummary>;

export function toMedicalIssueSummary(issue: MedicalIssue) {
  return {
    title: issue.title,
    begdate: issue.begdate,
    enddate: issue.enddate,
    active: !issue.enddate,
    diagnosis: toDiagnosisCodes(issue.diagnosis),
    comments: issue.comments,
  };
}

// Medical problems come from the ConditionRestController, which (unlike the
// legacy medication/surgery endpoints) returns a stable uuid — kept here
// because `updateMedicalProblem` addresses the problem by it.
export type MedicalProblemSummary = ReturnType<typeof toMedicalProblemSummary>;

export function toMedicalProblemSummary(issue: MedicalIssue) {
  return { uuid: issue.uuid, ...toMedicalIssueSummary(issue) };
}

export type LatestVitals = {
  date: string;
  vitals: VitalSummary;
};

/**
 * The most recent vitals reading with at least one recorded measurement,
 * across the given per-encounter vitals lists. Readings whose measurements
 * are all null (an empty vitals form) are skipped.
 */
export function pickLatestVitals(vitalLists: Vital[][]): LatestVitals | null {
  let latest: LatestVitals | null = null;
  for (const vital of vitalLists.flat()) {
    const summary = toVitalSummary(vital);
    const { date, ...measurements } = summary;
    const hasReading = Object.values(measurements).some(
      (value) => value !== null
    );
    if (!hasReading) {
      continue;
    }
    if (!latest || date > latest.date) {
      latest = { date, vitals: summary };
    }
  }
  return latest;
}

/**
 * Appointments on or after `today` (YYYY-MM-DD), sorted soonest first.
 * `pc_eventDate` is YYYY-MM-DD, which compares correctly as a string.
 */
export function filterUpcomingAppointments(
  appointments: Appointment[],
  today: string
): Appointment[] {
  return appointments
    .filter((appointment) => appointment.pc_eventDate >= today)
    .sort((a, b) =>
      `${a.pc_eventDate} ${a.pc_startTime}`.localeCompare(
        `${b.pc_eventDate} ${b.pc_startTime}`
      )
    );
}

/**
 * Titles of currently-active allergies — blank titles dropped, duplicates
 * deduped, original order preserved. Feeds the demographics allergy banner.
 */
export function activeAllergyTitles(
  allergies: MedicalIssueSummary[]
): string[] {
  return [
    ...new Set(
      allergies
        .filter((allergy) => allergy.active && allergy.title?.trim())
        .map((allergy) => allergy.title)
    ),
  ];
}
