import { AsyncLocalStorage } from "node:async_hooks";
import { demoDataset, type FixtureDataset } from "@/lib/openemr/demo-data";
import type {
  Appointment,
  Encounter,
  MedicalIssue,
  Patient,
  SoapNote,
  Vital,
} from "@/lib/openemr/types";

// Canned OpenEMR responses served by `openemrFetch` under the Playwright test
// environment (see lib/openemr/api.ts), so the AI data tools and the client
// proxy routes (patient-overview etc.) work e2e without an OpenEMR instance.
// The e2e tests assert on these names as string literals (they can't import
// app code) — keep tests/e2e/generative-ui.test.ts in sync when editing.

// The standard controllers wrap rows in the `{data}` envelope; the legacy
// ListRestController endpoints (appointment, soap_note, vital, medication,
// surgery) return bare arrays.
const envelope = <T>(data: T) => ({
  validationErrors: [],
  internalErrors: [],
  data,
});

const isoDaysFromNow = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  // Local date, not toISOString() (UTC) — the scribe picker filters on the
  // browser's local "today", which is the same machine in e2e runs, and UTC
  // runs a day ahead of the Americas every evening.
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const ELEANOR_UUID = "11111111-1111-4111-8111-111111111111";
const MARCUS_UUID = "22222222-2222-4222-8222-222222222222";

// `title`/`mname` left empty so toPatientSummary().name matches the
// appointment join's "fname lname" — both click targets get the same
// accessible name in tests.
const patients: Patient[] = [
  {
    id: 1,
    uuid: ELEANOR_UUID,
    pid: 1,
    pubpid: "PV-001",
    title: "",
    fname: "Eleanor",
    mname: "",
    lname: "Vance",
    DOB: "1948-03-12",
    sex: "Female",
    status: "active",
    email: "eleanor.vance@example.com",
    phone_home: "555-0101",
    phone_cell: "555-0102",
    street: "12 Harbor Lane",
    city: "Portland",
    state: "ME",
    postal_code: "04101",
    country_code: "US",
  },
  {
    id: 2,
    uuid: MARCUS_UUID,
    pid: 2,
    pubpid: "PV-002",
    title: "",
    fname: "Marcus",
    mname: "",
    lname: "Webb",
    DOB: "1985-07-22",
    sex: "Male",
    status: "active",
    email: "marcus.webb@example.com",
    phone_home: "",
    phone_cell: "555-0201",
    street: "88 Cedar Street",
    city: "Burlington",
    state: "VT",
    postal_code: "05401",
    country_code: "US",
  },
];

// Joined patient (fname/lname/DOB/pid/puuid), provider, and facility columns
// must be present — appointment rows are only clickable with pid + puuid.
// Dates are computed at module load so the patient-overview's upcoming filter
// always matches.
const appointments: Appointment[] = [
  {
    pc_eid: "300",
    pc_uuid: "33333333-3333-4333-8333-333333333300",
    fname: "Eleanor",
    lname: "Vance",
    DOB: "1948-03-12",
    pid: "1",
    puuid: ELEANOR_UUID,
    pce_aid_uuid: "44444444-4444-4444-8444-444444444444",
    pce_aid_fname: "Susan",
    pce_aid_lname: "Reyes",
    pce_aid_npi: "1234567890",
    pc_apptstatus: "@",
    pc_eventDate: isoDaysFromNow(0),
    pc_startTime: "08:30:00",
    pc_endTime: "09:00:00",
    pc_time: `${isoDaysFromNow(-7)} 09:55:00`,
    pc_title: "Hypertension Check",
    facility_name: "Harbor Family Practice",
  },
  {
    pc_eid: "301",
    pc_uuid: "33333333-3333-4333-8333-333333333301",
    fname: "Eleanor",
    lname: "Vance",
    DOB: "1948-03-12",
    pid: "1",
    puuid: ELEANOR_UUID,
    pce_aid_uuid: "44444444-4444-4444-8444-444444444444",
    pce_aid_fname: "Susan",
    pce_aid_lname: "Reyes",
    pce_aid_npi: "1234567890",
    pc_apptstatus: "-",
    pc_eventDate: isoDaysFromNow(1),
    pc_startTime: "09:00:00",
    pc_endTime: "09:30:00",
    pc_time: `${isoDaysFromNow(-7)} 10:00:00`,
    pc_title: "Follow-up Visit",
    facility_name: "Harbor Family Practice",
  },
  {
    pc_eid: "302",
    pc_uuid: "33333333-3333-4333-8333-333333333302",
    fname: "Marcus",
    lname: "Webb",
    DOB: "1985-07-22",
    pid: "2",
    puuid: MARCUS_UUID,
    pce_aid_uuid: "44444444-4444-4444-8444-444444444444",
    pce_aid_fname: "Susan",
    pce_aid_lname: "Reyes",
    pce_aid_npi: "1234567890",
    pc_apptstatus: "-",
    pc_eventDate: isoDaysFromNow(1),
    pc_startTime: "14:30:00",
    pc_endTime: "15:00:00",
    pc_time: `${isoDaysFromNow(-7)} 10:05:00`,
    pc_title: "Annual Physical",
    facility_name: "Harbor Family Practice",
  },
  {
    // Roomed and waiting today — the "next patient" getNextAppointment surfaces
    // at the end of a scribe session (Eleanor, pid 1, is excluded as the one
    // just seen).
    pc_eid: "304",
    pc_uuid: "33333333-3333-4333-8333-333333333304",
    fname: "Marcus",
    lname: "Webb",
    DOB: "1985-07-22",
    pid: "2",
    puuid: MARCUS_UUID,
    pce_aid_uuid: "44444444-4444-4444-8444-444444444444",
    pce_aid_fname: "Susan",
    pce_aid_lname: "Reyes",
    pce_aid_npi: "1234567890",
    pc_apptstatus: "<",
    pc_eventDate: isoDaysFromNow(0),
    pc_startTime: "09:15:00",
    pc_endTime: "09:45:00",
    pc_time: `${isoDaysFromNow(-7)} 10:07:00`,
    pc_title: "Knee Pain Follow-up",
    facility_name: "Harbor Family Practice",
  },
  {
    pc_eid: "303",
    pc_uuid: "33333333-3333-4333-8333-333333333303",
    fname: "Eleanor",
    lname: "Vance",
    DOB: "1948-03-12",
    pid: "1",
    puuid: ELEANOR_UUID,
    pce_aid_uuid: "44444444-4444-4444-8444-444444444444",
    pce_aid_fname: "Susan",
    pce_aid_lname: "Reyes",
    pce_aid_npi: "1234567890",
    pc_apptstatus: "-",
    pc_eventDate: isoDaysFromNow(3),
    pc_startTime: "11:00:00",
    pc_endTime: "11:30:00",
    pc_time: `${isoDaysFromNow(-7)} 10:10:00`,
    pc_title: "Lab Review",
    facility_name: "Harbor Family Practice",
  },
];

// Canned transcript returned by /api/transcribe in the test environment, so
// the scribe flow works e2e without a gateway transcription model. The e2e
// test asserts a distinctive phrase from it as a string literal.
// The closing line discusses a return visit on purpose: it's what makes the
// scribe script's slot search legitimate (scribePrompt says to skip it
// when no follow-up was discussed). The dermatology-referral line is likewise
// deliberate: it's what makes the scribe script's sendReferral wave legitimate
// (scribePrompt says to skip it when no referral was discussed).
export const SCRIBE_MOCK_TRANSCRIPT =
  "Good morning. Blood pressure today is 132 over 84, pulse 76. " +
  "The headaches have improved since we started lisinopril, so continue 10 milligrams daily. " +
  "Diagnosing seasonal allergic rhinitis today; start loratadine 10 milligrams as needed. " +
  "I also noticed a new pigmented lesion on your left forearm with irregular borders — " +
  "I'm referring you to dermatology to evaluate it and biopsy if warranted. " +
  "Let's recheck the blood pressure in six months.";

const encountersByUuid: Record<string, Encounter[]> = {
  [ELEANOR_UUID]: [
    {
      eid: 101,
      euuid: "55555555-5555-4555-8555-555555555101",
      date: `${isoDaysFromNow(-30)} 09:15:00`,
      reason: "Diabetes follow-up",
      class_title: "ambulatory",
      pc_catname: "Office Visit",
      facility_name: "Harbor Family Practice",
    },
  ],
  [MARCUS_UUID]: [
    {
      eid: 201,
      euuid: "55555555-5555-4555-8555-555555555201",
      date: `${isoDaysFromNow(-14)} 13:40:00`,
      reason: "Asthma check",
      class_title: "ambulatory",
      pc_catname: "Office Visit",
      facility_name: "Harbor Family Practice",
    },
  ],
};

// Keyed by "pid/eid", matching the legacy per-encounter endpoints.
const soapNotesByEncounter: Record<string, SoapNote[]> = {
  "1/101": [
    {
      id: 1,
      pid: 1,
      date: `${isoDaysFromNow(-30)} 09:45:00`,
      user: "sreyes",
      authorized: 1,
      activity: 1,
      subjective: "Reports stable energy; occasional evening thirst.",
      objective: "Feet exam normal. No edema.",
      assessment: "Type 2 diabetes, adequately controlled.",
      plan: "Continue metformin. Recheck A1c in 3 months.",
    },
  ],
  "2/201": [
    {
      id: 2,
      pid: 2,
      date: `${isoDaysFromNow(-14)} 14:05:00`,
      user: "sreyes",
      authorized: 1,
      activity: 1,
      subjective: "Wheezing after exercise, twice weekly.",
      objective: "Lungs clear at rest. Peak flow 88% predicted.",
      assessment: "Mild persistent asthma.",
      plan: "Start low-dose inhaled corticosteroid.",
    },
  ],
};

const vitalsByEncounter: Record<string, Vital[]> = {
  "1/101": [
    {
      id: 1,
      form_id: 1,
      date: `${isoDaysFromNow(-30)} 09:20:00`,
      bps: "132.000000",
      bpd: "78.000000",
      weight: "165.000000",
      height: "64.000000",
      temperature: "98.200000",
      pulse: "72.000000",
      respiration: "16.000000",
      oxygen_saturation: "98.000000",
    },
  ],
  "2/201": [
    {
      id: 2,
      form_id: 2,
      date: `${isoDaysFromNow(-14)} 13:45:00`,
      bps: "118.000000",
      bpd: "74.000000",
      weight: "182.000000",
      height: "71.000000",
      temperature: "98.600000",
      pulse: "66.000000",
      respiration: "14.000000",
      oxygen_saturation: "99.000000",
    },
  ],
};

const problemsByUuid: Record<string, MedicalIssue[]> = {
  [ELEANOR_UUID]: [
    {
      id: 1,
      uuid: "66666666-6666-4666-8666-666666666601",
      title: "Type 2 Diabetes Mellitus",
      begdate: "2015-06-01",
      enddate: null,
      diagnosis: {
        "E11.9": {
          code: "E11.9",
          description: "Type 2 diabetes mellitus without complications",
          code_type: "ICD10",
          system: "http://hl7.org/fhir/sid/icd-10-cm",
        },
      },
      comments: "Managed with metformin.",
      outcome: 0,
      occurrence: 0,
      referredby: "",
    },
  ],
  [MARCUS_UUID]: [
    {
      id: 2,
      uuid: "66666666-6666-4666-8666-666666666602",
      title: "Asthma",
      begdate: "2001-04-15",
      enddate: null,
      diagnosis: {
        "J45.909": {
          code: "J45.909",
          description: "Unspecified asthma, uncomplicated",
          code_type: "ICD10",
          system: "http://hl7.org/fhir/sid/icd-10-cm",
        },
      },
      comments: "",
      outcome: 0,
      occurrence: 0,
      referredby: "",
    },
  ],
};

const allergiesByUuid: Record<string, MedicalIssue[]> = {
  [ELEANOR_UUID]: [
    {
      id: 3,
      uuid: "66666666-6666-4666-8666-666666666603",
      title: "Penicillin",
      begdate: "1990-01-01",
      enddate: null,
      diagnosis: null,
      comments: "Hives.",
      outcome: 0,
      occurrence: 0,
      referredby: "",
    },
  ],
  [MARCUS_UUID]: [],
};

// Legacy pid-keyed lists (string diagnosis form).
const medicationsByPid: Record<string, MedicalIssue[]> = {
  "1": [
    {
      id: 4,
      uuid: "66666666-6666-4666-8666-666666666604",
      title: "Metformin 500mg",
      begdate: "2015-06-01",
      enddate: null,
      diagnosis: "ICD10:E11.9",
      comments: "Twice daily with meals.",
      outcome: 0,
      occurrence: 0,
      referredby: "",
    },
  ],
  "2": [
    {
      id: 6,
      uuid: "66666666-6666-4666-8666-666666666606",
      title: "Albuterol 90mcg inhaler",
      begdate: "2019-04-10",
      enddate: null,
      diagnosis: "ICD10:J45.909",
      comments: "Rescue inhaler, as needed.",
      outcome: 0,
      occurrence: 0,
      referredby: "",
    },
  ],
};

const surgeriesByPid: Record<string, MedicalIssue[]> = {
  "1": [
    {
      id: 5,
      uuid: "66666666-6666-4666-8666-666666666605",
      title: "Appendectomy",
      begdate: "1972-08-20",
      enddate: "1972-08-20",
      diagnosis: "",
      comments: "",
      outcome: 0,
      occurrence: 0,
      referredby: "",
    },
  ],
  "2": [],
};

// The deterministic 2-patient roster the e2e/eval runs assert on, bundled into
// the shared FixtureDataset shape. `getAppointments` returns the fixed list
// (dates already computed relative to today at module load). The demo instance
// serves `demoDataset` (lib/openemr/demo-data.ts) instead, selected per fixture
// state — see `activeDataset()`.
const testDataset: FixtureDataset = {
  patients,
  getAppointments: () => appointments,
  encountersByUuid,
  soapNotesByEncounter,
  vitalsByEncounter,
  problemsByUuid,
  allergiesByUuid,
  medicationsByPid,
  surgeriesByPid,
};

type FixtureParams = Record<
  string,
  string | number | boolean | null | undefined
>;

function matchesName(patient: Patient, params: FixtureParams | undefined) {
  const fname = params?.fname;
  const lname = params?.lname;
  return (
    (fname == null ||
      patient.fname.toLowerCase().includes(String(fname).toLowerCase())) &&
    (lname == null ||
      patient.lname.toLowerCase().includes(String(lname).toLowerCase()))
  );
}

// --- Stateful overlay -------------------------------------------------------
// Playwright runs keep the write endpoints stateless (one test's writes must
// not leak into the next, and nothing re-reads them). Two backends DO re-read
// and need writes to persist:
//   • Scribe eval runs (withFixtureState per row) — the charting protocol ends
//     with getEncounters limited to today; if a just-created encounter isn't
//     there the model concludes the write failed and retries, breaking the
//     "exactly one createEncounter" invariant.
//   • The demo instance (getOrCreateUserFixtureState per user) — the whole
//     point is that booked appointments and scribe chart writes stick.
// Statefulness is a per-state flag (not an env check), so the stateless default
// store used by Playwright is untouched. `dataset` lets the demo swap in its
// richer roster while the default store keeps the deterministic test roster.

type FixtureState = {
  stateful: boolean;
  // Which read-side roster this store serves. undefined → testDataset.
  dataset?: FixtureDataset;
  nextDynamicId: number;
  encountersByUuid: Record<string, Encounter[]>;
  // Keyed by "pid/eid", like the canned maps above.
  soapNotesByEncounter: Record<string, SoapNote[]>;
  vitalsByEncounter: Record<string, Vital[]>;
  // Flat, unlike the maps above: booked slots are read back both per-patient
  // and practice-wide (the availability tool reads the whole calendar).
  bookedAppointments: Appointment[];
  // Newly created problems/meds/surgeries, appended to the base roster on read.
  createdProblemsByUuid: Record<string, MedicalIssue[]>; // keyed by patient uuid
  createdMedicationsByPid: Record<string, MedicalIssue[]>; // keyed by pid
  createdSurgeriesByPid: Record<string, MedicalIssue[]>; // keyed by pid
  // Partial updates (updateMedicalProblem/updateMedication), applied over
  // whichever row matches on read. Keyed by the row's own uuid / id.
  problemPatchesByUuid: Record<string, Partial<MedicalIssue>>;
  medicationPatchesById: Record<string, Partial<MedicalIssue>>;
};

const createFixtureState = (
  options: { stateful?: boolean; dataset?: FixtureDataset } = {}
): FixtureState => ({
  stateful: options.stateful ?? false,
  dataset: options.dataset,
  nextDynamicId: 901,
  encountersByUuid: {},
  soapNotesByEncounter: {},
  vitalsByEncounter: {},
  bookedAppointments: [],
  createdProblemsByUuid: {},
  createdMedicationsByPid: {},
  createdSurgeriesByPid: {},
  problemPatchesByUuid: {},
  medicationPatchesById: {},
});

// The Next server (Playwright e2e) never enters a context and shares this
// stateless default store, exactly like the old module globals. Eval rows each
// run in their own context, so concurrent trials can't see each other's writes.
const defaultFixtureState = createFixtureState();
const fixtureStateStore = new AsyncLocalStorage<FixtureState>();
const fixtureState = () => fixtureStateStore.getStore() ?? defaultFixtureState;

// Whether the active store records writes (vs. returning canned ids only).
// True for explicitly stateful stores (eval rows via withFixtureState, demo
// per-user stores) and — preserving the original eval behavior — for the shared
// default store when OPENEMR_FIXTURES=true. Playwright (env unset, default
// store) stays stateless.
const statefulFixturesEnabled = () =>
  fixtureState().stateful || process.env.OPENEMR_FIXTURES === "true";

// The read-side roster the active store serves.
const activeDataset = (): FixtureDataset =>
  fixtureState().dataset ?? testDataset;

/**
 * Run fn against a fresh, private, stateful fixture overlay (evals: one per
 * row). The scope survives awaits inside fn, so an async fn's whole call tree —
 * tool executes, prefetches — reads and writes the same private store.
 */
export const withFixtureState = <T>(fn: () => T): T =>
  fixtureStateStore.run(createFixtureState({ stateful: true }), fn);

// --- Demo instance: one persistent stateful store per user ------------------
// The demo (lib/openemr/api.ts, when useOpenEmrDemo and the session has no
// OpenEMR token) serves the richer demoDataset. State is keyed by session user
// id (guests included), seeded lazily, and lives for the process lifetime, so a
// user's booked appointments and scribe chart writes persist across requests
// while staying isolated from other users.
//
// Anchored on globalThis, NOT a plain module const: Next.js bundles route
// handlers separately, so each route (e.g. /api/chat vs the /api/openemr/*
// proxies) can get its own instance of this module — and thus its own Map. A
// scribe turn's writes happen in the /api/chat bundle; the patient-overview
// proxy reads from the /api/openemr/patient-overview bundle. With a per-bundle
// Map the overview never sees those writes (though the chat route's own read
// tools do, since they share the chat bundle's Map). One process-wide Map on
// globalThis fixes that and also survives dev HMR.
const globalForDemo = globalThis as typeof globalThis & {
  __emrgentDemoFixtureStates?: Map<string, FixtureState>;
};
if (!globalForDemo.__emrgentDemoFixtureStates) {
  globalForDemo.__emrgentDemoFixtureStates = new Map<string, FixtureState>();
}
const demoStatesByUser: Map<string, FixtureState> =
  globalForDemo.__emrgentDemoFixtureStates;

function getOrCreateUserFixtureState(userId: string): FixtureState {
  let state = demoStatesByUser.get(userId);
  if (!state) {
    state = createFixtureState({ stateful: true, dataset: demoDataset });
    demoStatesByUser.set(userId, state);
  }
  return state;
}

/**
 * Resolve an OpenEMR REST path against the demo instance for a given user,
 * scoping the whole resolution to that user's persistent overlay so reads see
 * their own prior writes. Same return contract as `resolveOpenEmrFixture`.
 */
export function resolveDemoFixture(
  userId: string,
  path: string,
  params?: FixtureParams,
  method = "GET",
  body?: unknown
): unknown {
  return fixtureStateStore.run(getOrCreateUserFixtureState(userId), () =>
    resolveOpenEmrFixture(path, params, method, body)
  );
}

// Write bodies arrive as the JSON string openemrFetch was called with; treat
// anything unparsable as an empty record, matching the canned responses'
// indifference to their inputs.
function parseJsonBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "string") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// "09:00" + 900s -> "09:15:00", matching the calendar's HH:MM:SS columns.
function addSeconds(startTime: string, seconds: number) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const total = (hours || 0) * 3600 + (minutes || 0) * 60 + seconds;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:00`;
}

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

// Measurements arrive as decimal strings (see toVitalsBody); absent ones are
// null, like the real vitals form.
const asMeasurement = (value: unknown) =>
  typeof value === "string" ? value : null;

// Canned created-resource responses for the write endpoints. Stateless under
// Playwright; eval runs additionally record encounters and their attachments
// in the overlay above so later GETs can see them.
function resolveOpenEmrPostFixture(path: string, body?: unknown): unknown {
  const encounterMatch = /^\/api\/patient\/([^/]+)\/encounter$/.exec(path);
  if (encounterMatch) {
    if (!statefulFixturesEnabled()) {
      return envelope({
        encounter: 901,
        uuid: "55555555-5555-4555-8555-555555555901",
      });
    }
    const [, uuid] = encounterMatch;
    const state = fixtureState();
    const parsed = parseJsonBody(body);
    const eid = state.nextDynamicId++;
    const euuid = `55555555-5555-4555-8555-${String(eid).padStart(12, "0")}`;
    const rows = state.encountersByUuid[uuid] ?? [];
    rows.push({
      eid,
      euuid,
      date: `${asString(parsed.date, isoDaysFromNow(0))} 12:00:00`,
      reason: asString(parsed.reason),
      class_title: "ambulatory",
      pc_catname: asString(parsed.pc_catname, "Office Visit"),
      facility_name: "Harbor Family Practice",
    });
    state.encountersByUuid[uuid] = rows;
    return envelope({ encounter: eid, uuid: euuid });
  }
  const attachmentMatch =
    /^\/api\/patient\/([^/]+)\/encounter\/([^/]+)\/(soap_note|vital)$/.exec(
      path
    );
  if (attachmentMatch) {
    if (!statefulFixturesEnabled()) {
      return { id: 901 };
    }
    const [, pid, eid, leaf] = attachmentMatch;
    const state = fixtureState();
    const parsed = parseJsonBody(body);
    const id = state.nextDynamicId++;
    const key = `${pid}/${eid}`;
    if (leaf === "soap_note") {
      const rows = state.soapNotesByEncounter[key] ?? [];
      rows.push({
        id,
        pid: Number(pid),
        date: `${isoDaysFromNow(0)} 12:00:00`,
        user: "scribe-eval",
        authorized: 1,
        activity: 1,
        subjective: asString(parsed.subjective),
        objective: asString(parsed.objective),
        assessment: asString(parsed.assessment),
        plan: asString(parsed.plan),
      });
      state.soapNotesByEncounter[key] = rows;
    } else {
      const rows = state.vitalsByEncounter[key] ?? [];
      rows.push({
        id,
        form_id: id,
        date: `${isoDaysFromNow(0)} 12:00:00`,
        bps: asMeasurement(parsed.bps),
        bpd: asMeasurement(parsed.bpd),
        weight: asMeasurement(parsed.weight),
        height: asMeasurement(parsed.height),
        temperature: asMeasurement(parsed.temperature),
        pulse: asMeasurement(parsed.pulse),
        respiration: asMeasurement(parsed.respiration),
        oxygen_saturation: asMeasurement(parsed.oxygen_saturation),
      });
      state.vitalsByEncounter[key] = rows;
    }
    return { id };
  }
  const appointmentMatch = /^\/api\/patient\/([^/]+)\/appointment$/.exec(path);
  if (appointmentMatch) {
    if (!statefulFixturesEnabled()) {
      return { id: 905 };
    }
    // Record the booking so the slot is taken on the next availability read
    // and the appointment shows up on the patient's calendar.
    const [, pid] = appointmentMatch;
    const state = fixtureState();
    const parsed = parseJsonBody(body);
    const id = state.nextDynamicId++;
    const patient = activeDataset().patients.find(
      (row) => String(row.pid) === pid
    );
    const startTime = asString(parsed.pc_startTime, "09:00");
    const durationSeconds = Number(parsed.pc_duration) || 900;
    state.bookedAppointments.push({
      pc_eid: String(id),
      pc_uuid: `33333333-3333-4333-8333-${String(id).padStart(12, "0")}`,
      fname: patient?.fname ?? "",
      lname: patient?.lname ?? "",
      DOB: patient?.DOB ?? "",
      pid,
      puuid: patient?.uuid ?? "",
      pce_aid_uuid: "44444444-4444-4444-8444-444444444444",
      pce_aid_fname: "Susan",
      pce_aid_lname: "Reyes",
      pce_aid_npi: "1234567890",
      pc_apptstatus: asString(parsed.pc_apptstatus, "-"),
      pc_eventDate: asString(parsed.pc_eventDate, isoDaysFromNow(0)),
      pc_startTime: `${startTime}:00`.slice(0, 8),
      pc_endTime: addSeconds(startTime, durationSeconds),
      pc_duration: String(durationSeconds),
      pc_time: `${isoDaysFromNow(0)} 12:00:00`,
      pc_title: asString(parsed.pc_title, "Office Visit"),
      facility_name: "Harbor Family Practice",
    });
    return { id };
  }
  const problemMatch = /^\/api\/patient\/([^/]+)\/medical_problem$/.exec(path);
  if (problemMatch) {
    if (!statefulFixturesEnabled()) {
      return envelope({
        id: 902,
        uuid: "66666666-6666-4666-8666-666666666902",
      });
    }
    // Record the new problem under the uuid we return, so a follow-up
    // updateMedicalProblem (which PUTs by that uuid) can patch it.
    const [, uuid] = problemMatch;
    const state = fixtureState();
    const parsed = parseJsonBody(body);
    const id = state.nextDynamicId++;
    const rowUuid = `66666666-6666-4666-8666-${String(id).padStart(12, "0")}`;
    const rows = state.createdProblemsByUuid[uuid] ?? [];
    rows.push({
      id,
      uuid: rowUuid,
      title: asString(parsed.title),
      begdate: asString(parsed.begdate, isoDaysFromNow(0)),
      enddate: (parsed.enddate as string | null) ?? null,
      // Store the raw "ICD10:X" form; toDiagnosisCodes handles both shapes.
      diagnosis: asString(parsed.diagnosis),
      comments: asString(parsed.comments),
      outcome: 0,
      occurrence: 0,
      referredby: "",
    });
    state.createdProblemsByUuid[uuid] = rows;
    return envelope({ id, uuid: rowUuid });
  }
  // Portal message: stateless — nothing re-reads sent messages.
  if (/^\/api\/patient\/[^/]+\/message$/.test(path)) {
    return envelope({ id: 906 });
  }
  // Referral transaction (LBTref): stateless — nothing re-reads it.
  if (/^\/api\/patient\/[^/]+\/transaction$/.test(path)) {
    return envelope({ id: 907 });
  }
  // Legacy ListRestController write responses: bare row, no envelope.
  const medicationMatch = /^\/api\/patient\/([^/]+)\/medication$/.exec(path);
  if (medicationMatch) {
    if (!statefulFixturesEnabled()) {
      return { id: 903 };
    }
    const [, pid] = medicationMatch;
    const state = fixtureState();
    const parsed = parseJsonBody(body);
    const id = state.nextDynamicId++;
    const rows = state.createdMedicationsByPid[pid] ?? [];
    rows.push({
      id,
      uuid: `ed000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
      title: asString(parsed.title),
      begdate: asString(parsed.begdate, isoDaysFromNow(0)),
      enddate: (parsed.enddate as string | null) ?? null,
      diagnosis: asString(parsed.diagnosis),
      comments: asString(parsed.comments),
      outcome: 0,
      occurrence: 0,
      referredby: "",
    });
    state.createdMedicationsByPid[pid] = rows;
    return { id };
  }
  const surgeryMatch = /^\/api\/patient\/([^/]+)\/surgery$/.exec(path);
  if (surgeryMatch) {
    if (!statefulFixturesEnabled()) {
      return { id: 904 };
    }
    const [, pid] = surgeryMatch;
    const state = fixtureState();
    const parsed = parseJsonBody(body);
    const id = state.nextDynamicId++;
    const rows = state.createdSurgeriesByPid[pid] ?? [];
    rows.push({
      id,
      uuid: `50000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
      title: asString(parsed.title),
      begdate: asString(parsed.begdate, isoDaysFromNow(0)),
      enddate: (parsed.enddate as string | null) ?? null,
      diagnosis: asString(parsed.diagnosis),
      comments: asString(parsed.comments),
      outcome: 0,
      occurrence: 0,
      referredby: "",
    });
    state.createdSurgeriesByPid[pid] = rows;
    return { id };
  }
  return;
}

// Apply recorded update patches over a list of issues, keyed by each row's own
// identifier. Patched rows are shallow-cloned so the shared base dataset is
// never mutated; unpatched rows pass through unchanged.
function applyIssuePatches(
  rows: MedicalIssue[],
  patchesByKey: Record<string, Partial<MedicalIssue>>,
  keyOf: (row: MedicalIssue) => string
): MedicalIssue[] {
  return rows.map((row) => {
    const patch = patchesByKey[keyOf(row)];
    return patch ? { ...row, ...patch } : row;
  });
}

/**
 * Resolve an OpenEMR REST path to its canned response. Returns `undefined`
 * for paths with no fixture — the caller maps that to a 404, which is what
 * the real API's legacy endpoints do (and callers already tolerate).
 */
export function resolveOpenEmrFixture(
  path: string,
  params?: FixtureParams,
  method = "GET",
  body?: unknown
): unknown {
  if (method.toUpperCase() === "POST") {
    return resolveOpenEmrPostFixture(path, body);
  }
  // PUT medical_problem/{muuid} and medication/{mid}: canned updated-record
  // responses (envelope vs bare row, matching each backend). When stateful,
  // also record the change so the next GET reflects it. Other PUTs (the
  // soap-note save) intentionally fall through to the GET resolution below,
  // which serves the same canned rows the real API would re-fetch.
  const problemPutMatch =
    method.toUpperCase() === "PUT" &&
    /^\/api\/patient\/[^/]+\/medical_problem\/([^/]+)$/.exec(path);
  if (problemPutMatch) {
    if (statefulFixturesEnabled()) {
      const [, muuid] = problemPutMatch;
      const state = fixtureState();
      state.problemPatchesByUuid[muuid] = {
        ...state.problemPatchesByUuid[muuid],
        ...(parseJsonBody(body) as Partial<MedicalIssue>),
      };
    }
    return envelope({
      id: 902,
      uuid: "66666666-6666-4666-8666-666666666902",
    });
  }
  const medicationPutMatch =
    method.toUpperCase() === "PUT" &&
    /^\/api\/patient\/[^/]+\/medication\/([^/]+)$/.exec(path);
  if (medicationPutMatch) {
    if (statefulFixturesEnabled()) {
      const [, mid] = medicationPutMatch;
      const state = fixtureState();
      state.medicationPatchesById[mid] = {
        ...state.medicationPatchesById[mid],
        ...(parseJsonBody(body) as Partial<MedicalIssue>),
      };
    }
    return { id: 903 };
  }
  const data = activeDataset();
  if (path === "/api/patient") {
    return envelope(
      data.patients.filter((patient) => matchesName(patient, params))
    );
  }
  if (path === "/api/appointment") {
    return [...data.getAppointments(), ...fixtureState().bookedAppointments];
  }

  const patientMatch = /^\/api\/patient\/([^/]+)(?:\/(.+))?$/.exec(path);
  if (!patientMatch) {
    return;
  }
  const [, key, rest] = patientMatch;
  const state = fixtureState();

  switch (rest) {
    // Bare /api/patient/{uuid}: the single-patient record, uuid-keyed like
    // the real controller. Feeds the overview's demographics section.
    // An unknown uuid falls through to the no-fixture behavior below.
    case undefined: {
      const patient = data.patients.find((row) => row.uuid === key);
      return patient ? envelope(patient) : undefined;
    }
    case "appointment":
      return [...data.getAppointments(), ...state.bookedAppointments].filter(
        (appointment) => appointment.pid === key
      );
    case "encounter":
      return envelope([
        ...(data.encountersByUuid[key] ?? []),
        ...(state.encountersByUuid[key] ?? []),
      ]);
    case "medical_problem":
      // Base + created problems, with any updateMedicalProblem patches applied.
      return envelope(
        applyIssuePatches(
          [
            ...(data.problemsByUuid[key] ?? []),
            ...(state.createdProblemsByUuid[key] ?? []),
          ],
          state.problemPatchesByUuid,
          (row) => row.uuid
        )
      );
    case "allergy":
      return envelope(data.allergiesByUuid[key] ?? []);
    case "medication": {
      // Legacy endpoint: undefined (→ 404) when the patient has no meds and
      // none were created; otherwise base + created with update patches.
      const base = data.medicationsByPid[key];
      const created = state.createdMedicationsByPid[key];
      if (!(base || created)) {
        return;
      }
      return applyIssuePatches(
        [...(base ?? []), ...(created ?? [])],
        state.medicationPatchesById,
        (row) => String(row.id)
      );
    }
    case "surgery": {
      const base = data.surgeriesByPid[key];
      const created = state.createdSurgeriesByPid[key];
      if (!(base || created)) {
        return;
      }
      return [...(base ?? []), ...(created ?? [])];
    }
    default: {
      const encounterMatch = /^encounter\/([^/]+)\/(soap_note|vital)$/.exec(
        rest ?? ""
      );
      if (!encounterMatch) {
        return;
      }
      const [, eid, leaf] = encounterMatch;
      const [byEncounter, dynamicByEncounter] =
        leaf === "soap_note"
          ? [data.soapNotesByEncounter, state.soapNotesByEncounter]
          : [data.vitalsByEncounter, state.vitalsByEncounter];
      return [
        ...(byEncounter[`${key}/${eid}`] ?? []),
        ...(dynamicByEncounter[`${key}/${eid}`] ?? []),
      ];
    }
  }
}
