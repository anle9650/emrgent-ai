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
  return date.toISOString().slice(0, 10);
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
  "2": [],
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

// Canned created-resource responses for the write endpoints. Stateless: the
// new rows are not appended to the fixture arrays above.
function resolveOpenEmrPostFixture(path: string): unknown {
  if (/^\/api\/patient\/[^/]+\/encounter$/.test(path)) {
    return envelope({
      encounter: 901,
      uuid: "55555555-5555-4555-8555-555555555901",
    });
  }
  if (
    /^\/api\/patient\/[^/]+\/encounter\/[^/]+\/(?:soap_note|vital)$/.test(path)
  ) {
    return { id: 901 };
  }
  if (/^\/api\/patient\/[^/]+\/medical_problem$/.test(path)) {
    return envelope({
      id: 902,
      uuid: "66666666-6666-4666-8666-666666666902",
    });
  }
  // Legacy ListRestController write response: bare row, no envelope.
  if (/^\/api\/patient\/[^/]+\/medication$/.test(path)) {
    return { id: 903 };
  }
  return;
}

/**
 * Resolve an OpenEMR REST path to its canned response. Returns `undefined`
 * for paths with no fixture — the caller maps that to a 404, which is what
 * the real API's legacy endpoints do (and callers already tolerate).
 */
export function resolveOpenEmrFixture(
  path: string,
  params?: FixtureParams,
  method = "GET"
): unknown {
  if (method.toUpperCase() === "POST") {
    return resolveOpenEmrPostFixture(path);
  }
  // PUT medical_problem/{muuid} and medication/{mid}: canned updated-record
  // responses (envelope vs bare row, matching each backend). Other PUTs (the
  // soap-note save) intentionally fall through to the GET resolution below,
  // which serves the same canned rows the real API would re-fetch.
  if (
    method.toUpperCase() === "PUT" &&
    /^\/api\/patient\/[^/]+\/medical_problem\/[^/]+$/.test(path)
  ) {
    return envelope({
      id: 902,
      uuid: "66666666-6666-4666-8666-666666666902",
    });
  }
  if (
    method.toUpperCase() === "PUT" &&
    /^\/api\/patient\/[^/]+\/medication\/[^/]+$/.test(path)
  ) {
    return { id: 903 };
  }
  if (path === "/api/patient") {
    return envelope(patients.filter((patient) => matchesName(patient, params)));
  }
  if (path === "/api/appointment") {
    return appointments;
  }

  const patientMatch = /^\/api\/patient\/([^/]+)(?:\/(.+))?$/.exec(path);
  if (!patientMatch) {
    return;
  }
  const [, key, rest] = patientMatch;

  switch (rest) {
    case "appointment":
      return appointments.filter((appointment) => appointment.pid === key);
    case "encounter":
      return envelope(encountersByUuid[key] ?? []);
    case "medical_problem":
      return envelope(problemsByUuid[key] ?? []);
    case "allergy":
      return envelope(allergiesByUuid[key] ?? []);
    case "medication":
      return medicationsByPid[key];
    case "surgery":
      return surgeriesByPid[key];
    default: {
      const encounterMatch = /^encounter\/([^/]+)\/(soap_note|vital)$/.exec(
        rest ?? ""
      );
      if (!encounterMatch) {
        return;
      }
      const [, eid, leaf] = encounterMatch;
      const byEncounter =
        leaf === "soap_note" ? soapNotesByEncounter : vitalsByEncounter;
      return byEncounter[`${key}/${eid}`] ?? [];
    }
  }
}
