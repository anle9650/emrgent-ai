/**
 * The standard OpenEMR REST API wraps every response in this envelope. `data`
 * is a single object or an array depending on the endpoint, so callers pass the
 * concrete shape as the type parameter, e.g. `OpenEmrResponse<Patient[]>`.
 */
export type OpenEmrResponse<T> = {
  validationErrors: unknown[];
  internalErrors: unknown[];
  data: T;
  links?: Record<string, string>;
};

/** Subset of the OpenEMR patient record the app relies on. */
export type Patient = {
  id: number;
  uuid: string;
  pid: number;
  pubpid: string;
  title: string;
  fname: string;
  mname: string;
  lname: string;
  DOB: string;
  sex: string;
  status: string;
  email: string;
  phone_home: string;
  phone_cell: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  // OpenEMR returns many more columns; keep them available without listing all.
  [key: string]: unknown;
};

export type Encounter = {
  eid: number;
  euuid: string;
  date: string;
  reason: string;
  class_title: string;
  pc_catname: string; // display label for the appointment/event category (e.g. "Office Visit")
  facility_name: string;
};

/**
 * OpenEMR calendar appointment record. The endpoint joins in patient
 * (fname/lname/pid/puuid), provider (pce_aid_*), and facility columns.
 * Numeric ids come back as strings.
 */
export type Appointment = {
  pc_eid: string;
  pc_uuid: string;
  fname: string;
  lname: string;
  DOB: string;
  pid: string;
  puuid: string;
  pce_aid_uuid: string;
  pce_aid_fname: string;
  pce_aid_lname: string;
  pce_aid_npi: string | null;
  pc_apptstatus: string;
  pc_eventDate: string;
  pc_startTime: string;
  pc_endTime: string;
  pc_time: string; // timestamp the appointment row was created/modified
  pc_title: string;
  facility_name: string;
};

/**
 * OpenEMR vitals form record attached to an encounter. Measurements are
 * decimal strings (e.g. "195.000000"), or null when not recorded; each has a
 * matching `*_unit` column (e.g. `weight_unit: "lb"`, `bps_unit: "mm[Hg]"`).
 */
export type Vital = {
  id: number;
  form_id: number;
  date: string;
  bps: string | null; // systolic blood pressure
  bpd: string | null; // diastolic blood pressure
  weight: string | null;
  height: string | null;
  temperature: string | null;
  pulse: string | null;
  respiration: string | null;
  oxygen_saturation: string | null;
  [key: string]: unknown;
};

/** One parsed code from OpenEMR's `addCoding()` (ConditionService). */
export type DiagnosisCoding = {
  code: string;
  description: string;
  code_type: string;
  system: string;
};

/**
 * OpenEMR "issues" list entry (`lists` table) — the shape shared by the
 * medical_problem, medication, and surgery endpoints.
 *
 * `diagnosis` differs by backend: the medical_problem endpoint
 * (ConditionRestController) expands it into an object keyed by code, while
 * medication/surgery (legacy ListRestController) return the raw string
 * ("ICD10:E11.9", semicolon-separated when multiple). Empty is "" or null.
 */
export type MedicalIssue = {
  id: number;
  uuid: string;
  title: string;
  begdate: string | null;
  enddate: string | null; // null/empty => still active
  diagnosis: string | Record<string, DiagnosisCoding> | null;
  comments: string;
  outcome: string | number;
  occurrence: string | number;
  referredby: string;
  // OpenEMR returns many more lists-table columns; same escape hatch as Patient.
  [key: string]: unknown;
};

export type SoapNote = {
  id: number;
  pid: number;
  date: string;
  user: string;
  authorized: number; // whether the note is signed/authorized. 1: signed, 0: not signed
  activity: number; // whether the note is active. 1: active, 0: deleted/inactive (soft deleted)
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};
