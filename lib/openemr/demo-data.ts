import type {
  Appointment,
  Encounter,
  MedicalIssue,
  Patient,
  SoapNote,
  Vital,
} from "@/lib/openemr/types";

// The expanded, internally-consistent roster served by the demo OpenEMR
// instance (lib/openemr/api.ts, when useOpenEmrDemo and the session has no
// OpenEMR token). Unlike the small test/eval fixture (lib/openemr/fixtures.ts's
// `testDataset`, which the e2e tests assert on as string literals), this is a
// full ~8-patient practice with a fresh full-day schedule generated on every
// read, so a demo always has patients to chart regardless of the calendar day.

// --- shared shape both datasets conform to ---------------------------------

/**
 * The read-side canned data the fixture resolver serves, bundled so it can be
 * swapped between the deterministic test roster and the richer demo roster.
 * `getAppointments` is a function (not a field) so the demo can compute a
 * schedule for the *current* day on every call.
 */
export type FixtureDataset = {
  patients: Patient[];
  getAppointments: () => Appointment[];
  encountersByUuid: Record<string, Encounter[]>;
  soapNotesByEncounter: Record<string, SoapNote[]>;
  vitalsByEncounter: Record<string, Vital[]>;
  problemsByUuid: Record<string, MedicalIssue[]>;
  allergiesByUuid: Record<string, MedicalIssue[]>;
  medicationsByPid: Record<string, MedicalIssue[]>;
  surgeriesByPid: Record<string, MedicalIssue[]>;
};

// Local YYYY-MM-DD, offset by `days`. Mirrors fixtures.ts's isoDaysFromNow —
// deliberately local, not UTC, so "today" matches the browser's calendar in the
// scribe picker and the patient-overview upcoming filter.
function localDatePlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// One provider and facility across the whole demo practice.
const PROVIDER = {
  uuid: "44444444-4444-4444-8444-444444444444",
  fname: "Susan",
  lname: "Reyes",
  npi: "1234567890",
} as const;
const FACILITY = "Harbor Family Practice";

// --- compact per-patient seed ----------------------------------------------

type Seed = {
  pid: number;
  uuid: string;
  fname: string;
  lname: string;
  DOB: string;
  sex: "Male" | "Female";
  city: string;
  state: string;
  problem: {
    title: string;
    icd10: string;
    codeDescription: string;
    begdate: string;
    comments: string;
  };
  medication: { title: string; begdate: string; comments: string };
  surgery?: { title: string; date: string };
  allergy?: { title: string; reaction: string };
  // The most recent completed visit, rendered into an encounter + SOAP + vitals.
  prior: {
    daysAgo: number;
    reason: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    vitals: {
      bps: number;
      bpd: number;
      weight: number;
      height: number;
      temperature: number;
      pulse: number;
      respiration: number;
      oxygen_saturation: number;
    };
  };
  // Chief complaint for today's appointment (pc_title).
  todayReason: string;
};

// Eight patients, each a coherent chart: the problem, the medication that
// treats it, a matching prior encounter (SOAP + vitals), and a today reason
// that follows from the problem.
const SEEDS: Seed[] = [
  {
    pid: 1,
    uuid: "11111111-1111-4111-8111-111111111111",
    fname: "Eleanor",
    lname: "Vance",
    DOB: "1948-03-12",
    sex: "Female",
    city: "Portland",
    state: "ME",
    problem: {
      title: "Type 2 Diabetes Mellitus",
      icd10: "E11.9",
      codeDescription: "Type 2 diabetes mellitus without complications",
      begdate: "2015-06-01",
      comments: "Managed with metformin.",
    },
    medication: {
      title: "Metformin 500mg",
      begdate: "2015-06-01",
      comments: "Twice daily with meals.",
    },
    surgery: { title: "Appendectomy", date: "1972-08-20" },
    allergy: { title: "Penicillin", reaction: "Hives." },
    prior: {
      daysAgo: 95,
      reason: "Diabetes follow-up",
      subjective: "Reports stable energy; occasional evening thirst.",
      objective: "Feet exam normal. No edema.",
      assessment: "Type 2 diabetes, adequately controlled.",
      plan: "Continue metformin. Recheck A1c in 3 months.",
      vitals: {
        bps: 132,
        bpd: 78,
        weight: 165,
        height: 64,
        temperature: 98.2,
        pulse: 72,
        respiration: 16,
        oxygen_saturation: 98,
      },
    },
    todayReason: "Diabetes follow-up",
  },
  {
    pid: 2,
    uuid: "22222222-2222-4222-8222-222222222222",
    fname: "Marcus",
    lname: "Webb",
    DOB: "1985-07-22",
    sex: "Male",
    city: "Burlington",
    state: "VT",
    problem: {
      title: "Asthma",
      icd10: "J45.909",
      codeDescription: "Unspecified asthma, uncomplicated",
      begdate: "2001-04-15",
      comments: "Exercise-induced component.",
    },
    medication: {
      title: "Albuterol 90mcg inhaler",
      begdate: "2019-04-10",
      comments: "Rescue inhaler, as needed.",
    },
    prior: {
      daysAgo: 44,
      reason: "Asthma check",
      subjective: "Wheezing after exercise, twice weekly.",
      objective: "Lungs clear at rest. Peak flow 88% predicted.",
      assessment: "Mild persistent asthma.",
      plan: "Start low-dose inhaled corticosteroid.",
      vitals: {
        bps: 118,
        bpd: 74,
        weight: 182,
        height: 71,
        temperature: 98.6,
        pulse: 66,
        respiration: 14,
        oxygen_saturation: 99,
      },
    },
    todayReason: "Asthma follow-up",
  },
  {
    pid: 3,
    uuid: "33333333-3333-4333-8333-333333333001",
    fname: "Priya",
    lname: "Nair",
    DOB: "1972-11-03",
    sex: "Female",
    city: "Providence",
    state: "RI",
    problem: {
      title: "Essential Hypertension",
      icd10: "I10",
      codeDescription: "Essential (primary) hypertension",
      begdate: "2018-02-20",
      comments: "Diet-modifiable, on single agent.",
    },
    medication: {
      title: "Lisinopril 10mg",
      begdate: "2018-02-20",
      comments: "Once daily.",
    },
    prior: {
      daysAgo: 60,
      reason: "Blood pressure check",
      subjective: "No headaches or dizziness. Taking medication daily.",
      objective: "BP 138/86 in office. Heart regular rate and rhythm.",
      assessment: "Hypertension, borderline controlled.",
      plan: "Continue lisinopril. Recheck in 2 months; home BP log.",
      vitals: {
        bps: 138,
        bpd: 86,
        weight: 154,
        height: 65,
        temperature: 98.4,
        pulse: 74,
        respiration: 15,
        oxygen_saturation: 98,
      },
    },
    todayReason: "Hypertension follow-up",
  },
  {
    pid: 4,
    uuid: "44444444-4444-4444-8444-444444440004",
    fname: "James",
    lname: "O'Brien",
    DOB: "1965-05-18",
    sex: "Male",
    city: "Nashua",
    state: "NH",
    problem: {
      title: "Hyperlipidemia",
      icd10: "E78.5",
      codeDescription: "Hyperlipidemia, unspecified",
      begdate: "2016-09-12",
      comments: "Statin-responsive.",
    },
    medication: {
      title: "Atorvastatin 20mg",
      begdate: "2016-09-12",
      comments: "Nightly.",
    },
    surgery: { title: "Cholecystectomy", date: "2009-03-04" },
    prior: {
      daysAgo: 120,
      reason: "Lipid panel review",
      subjective: "Tolerating statin, no muscle aches.",
      objective: "LDL 96, down from 142. No xanthelasma.",
      assessment: "Hyperlipidemia improving on therapy.",
      plan: "Continue atorvastatin. Repeat lipids in 6 months.",
      vitals: {
        bps: 128,
        bpd: 80,
        weight: 201,
        height: 70,
        temperature: 98.1,
        pulse: 70,
        respiration: 16,
        oxygen_saturation: 97,
      },
    },
    todayReason: "Lipid management",
  },
  {
    pid: 5,
    uuid: "55555555-5555-4555-8555-555555550005",
    fname: "Sofia",
    lname: "Delgado",
    DOB: "1990-01-27",
    sex: "Female",
    city: "Hartford",
    state: "CT",
    problem: {
      title: "Hypothyroidism",
      icd10: "E03.9",
      codeDescription: "Hypothyroidism, unspecified",
      begdate: "2020-07-08",
      comments: "Post-partum onset.",
    },
    medication: {
      title: "Levothyroxine 75mcg",
      begdate: "2020-07-08",
      comments: "Morning, empty stomach.",
    },
    prior: {
      daysAgo: 75,
      reason: "Thyroid follow-up",
      subjective: "Energy improved. Weight stable.",
      objective: "No goiter. Reflexes normal.",
      assessment: "Hypothyroidism, replaced to target.",
      plan: "Continue levothyroxine. TSH in 3 months.",
      vitals: {
        bps: 112,
        bpd: 70,
        weight: 138,
        height: 63,
        temperature: 98.0,
        pulse: 68,
        respiration: 14,
        oxygen_saturation: 99,
      },
    },
    todayReason: "Thyroid follow-up",
  },
  {
    pid: 6,
    uuid: "66666666-6666-4666-8666-666666660006",
    fname: "Henry",
    lname: "Kwon",
    DOB: "1978-09-14",
    sex: "Male",
    city: "Worcester",
    state: "MA",
    problem: {
      title: "Gastroesophageal Reflux Disease",
      icd10: "K21.9",
      codeDescription: "Gastro-esophageal reflux disease without esophagitis",
      begdate: "2019-11-30",
      comments: "Nocturnal symptoms.",
    },
    medication: {
      title: "Omeprazole 20mg",
      begdate: "2019-11-30",
      comments: "Before breakfast.",
    },
    prior: {
      daysAgo: 50,
      reason: "Reflux follow-up",
      subjective: "Heartburn much reduced on omeprazole.",
      objective: "Abdomen soft, non-tender.",
      assessment: "GERD, well controlled.",
      plan: "Continue omeprazole. Trial step-down in 3 months.",
      vitals: {
        bps: 124,
        bpd: 78,
        weight: 176,
        height: 69,
        temperature: 98.5,
        pulse: 72,
        respiration: 15,
        oxygen_saturation: 98,
      },
    },
    todayReason: "Reflux follow-up",
  },
  {
    pid: 7,
    uuid: "77777777-7777-4777-8777-777777770007",
    fname: "Amara",
    lname: "Okafor",
    DOB: "1995-06-09",
    sex: "Female",
    city: "Stamford",
    state: "CT",
    problem: {
      title: "Migraine",
      icd10: "G43.909",
      codeDescription:
        "Migraine, unspecified, not intractable, without status migrainosus",
      begdate: "2014-03-22",
      comments: "Episodic, aura in half of episodes.",
    },
    medication: {
      title: "Sumatriptan 50mg",
      begdate: "2017-01-15",
      comments: "At onset, may repeat once.",
    },
    prior: {
      daysAgo: 38,
      reason: "Migraine management",
      subjective: "Three migraines this month, sumatriptan effective.",
      objective: "Neuro exam non-focal.",
      assessment: "Episodic migraine.",
      plan: "Continue sumatriptan. Consider prophylaxis if frequency rises.",
      vitals: {
        bps: 116,
        bpd: 72,
        weight: 141,
        height: 66,
        temperature: 98.3,
        pulse: 70,
        respiration: 14,
        oxygen_saturation: 99,
      },
    },
    todayReason: "Migraine management",
  },
  {
    pid: 8,
    uuid: "88888888-8888-4888-8888-888888880008",
    fname: "Walter",
    lname: "Brennan",
    DOB: "1958-12-01",
    sex: "Male",
    city: "Manchester",
    state: "NH",
    problem: {
      title: "Osteoarthritis of Right Knee",
      icd10: "M17.11",
      codeDescription: "Unilateral primary osteoarthritis, right knee",
      begdate: "2012-05-19",
      comments: "Activity-related pain.",
    },
    medication: {
      title: "Naproxen 500mg",
      begdate: "2021-08-01",
      comments: "Twice daily with food, as needed.",
    },
    surgery: { title: "Right knee arthroscopy", date: "2013-06-11" },
    prior: {
      daysAgo: 30,
      reason: "Knee pain follow-up",
      subjective: "Pain worse with stairs. Naproxen helps.",
      objective: "Right knee crepitus, no effusion.",
      assessment: "Knee osteoarthritis.",
      plan: "Continue naproxen PRN. Referral to PT.",
      vitals: {
        bps: 134,
        bpd: 82,
        weight: 198,
        height: 72,
        temperature: 98.2,
        pulse: 74,
        respiration: 16,
        oxygen_saturation: 97,
      },
    },
    todayReason: "Knee pain follow-up",
  },
];

// --- expand the seeds into the resolver's record maps ----------------------

const eidFor = (pid: number) => 1000 + pid;
const euuidFor = (pid: number) =>
  `5e000000-0000-4000-8000-${String(eidFor(pid)).padStart(12, "0")}`;
const encounterKey = (pid: number) => `${pid}/${eidFor(pid)}`;
const dec = (value: number) => value.toFixed(6);

const patients: Patient[] = SEEDS.map((seed) => ({
  id: seed.pid,
  uuid: seed.uuid,
  pid: seed.pid,
  pubpid: `PV-${String(seed.pid).padStart(3, "0")}`,
  title: "",
  fname: seed.fname,
  mname: "",
  lname: seed.lname,
  DOB: seed.DOB,
  sex: seed.sex,
  status: "active",
  email: `${seed.fname}.${seed.lname}@example.com`
    .toLowerCase()
    .replace(/'/g, ""),
  phone_home: "",
  phone_cell: `555-0${String(100 + seed.pid).slice(-3)}`,
  street: `${seed.pid} Harbor Lane`,
  city: seed.city,
  state: seed.state,
  postal_code: "04101",
  country_code: "US",
}));

const encountersByUuid: Record<string, Encounter[]> = {};
const soapNotesByEncounter: Record<string, SoapNote[]> = {};
const vitalsByEncounter: Record<string, Vital[]> = {};
const problemsByUuid: Record<string, MedicalIssue[]> = {};
const allergiesByUuid: Record<string, MedicalIssue[]> = {};
const medicationsByPid: Record<string, MedicalIssue[]> = {};
const surgeriesByPid: Record<string, MedicalIssue[]> = {};

for (const seed of SEEDS) {
  const eid = eidFor(seed.pid);
  const priorDate = localDatePlusDays(-seed.prior.daysAgo);

  encountersByUuid[seed.uuid] = [
    {
      eid,
      euuid: euuidFor(seed.pid),
      date: `${priorDate} 09:15:00`,
      reason: seed.prior.reason,
      class_title: "ambulatory",
      pc_catname: "Office Visit",
      facility_name: FACILITY,
    },
  ];

  soapNotesByEncounter[encounterKey(seed.pid)] = [
    {
      id: eid,
      pid: seed.pid,
      date: `${priorDate} 09:45:00`,
      user: "sreyes",
      authorized: 1,
      activity: 1,
      subjective: seed.prior.subjective,
      objective: seed.prior.objective,
      assessment: seed.prior.assessment,
      plan: seed.prior.plan,
    },
  ];

  const v = seed.prior.vitals;
  vitalsByEncounter[encounterKey(seed.pid)] = [
    {
      id: eid,
      form_id: eid,
      date: `${priorDate} 09:20:00`,
      bps: dec(v.bps),
      bpd: dec(v.bpd),
      weight: dec(v.weight),
      height: dec(v.height),
      temperature: dec(v.temperature),
      pulse: dec(v.pulse),
      respiration: dec(v.respiration),
      oxygen_saturation: dec(v.oxygen_saturation),
    },
  ];

  problemsByUuid[seed.uuid] = [
    {
      id: seed.pid * 10 + 1,
      uuid: `6b000000-0000-4000-8000-${String(seed.pid).padStart(12, "0")}`,
      title: seed.problem.title,
      begdate: seed.problem.begdate,
      enddate: null,
      diagnosis: {
        [seed.problem.icd10]: {
          code: seed.problem.icd10,
          description: seed.problem.codeDescription,
          code_type: "ICD10",
          system: "http://hl7.org/fhir/sid/icd-10-cm",
        },
      },
      comments: seed.problem.comments,
      outcome: 0,
      occurrence: 0,
      referredby: "",
    },
  ];

  allergiesByUuid[seed.uuid] = seed.allergy
    ? [
        {
          id: seed.pid * 10 + 2,
          uuid: `a1000000-0000-4000-8000-${String(seed.pid).padStart(12, "0")}`,
          title: seed.allergy.title,
          begdate: "1990-01-01",
          enddate: null,
          diagnosis: null,
          comments: seed.allergy.reaction,
          outcome: 0,
          occurrence: 0,
          referredby: "",
        },
      ]
    : [];

  medicationsByPid[String(seed.pid)] = [
    {
      id: seed.pid * 10 + 3,
      uuid: `ed000000-0000-4000-8000-${String(seed.pid).padStart(12, "0")}`,
      title: seed.medication.title,
      begdate: seed.medication.begdate,
      enddate: null,
      diagnosis: `ICD10:${seed.problem.icd10}`,
      comments: seed.medication.comments,
      outcome: 0,
      occurrence: 0,
      referredby: "",
    },
  ];

  surgeriesByPid[String(seed.pid)] = seed.surgery
    ? [
        {
          id: seed.pid * 10 + 4,
          uuid: `50000000-0000-4000-8000-${String(seed.pid).padStart(12, "0")}`,
          title: seed.surgery.title,
          begdate: seed.surgery.date,
          enddate: seed.surgery.date,
          diagnosis: "",
          comments: "",
          outcome: 0,
          occurrence: 0,
          referredby: "",
        },
      ]
    : [];
}

// --- today's full schedule (generated per read) ----------------------------

// Quarter-hour-aligned starts across a working day, one per roster patient.
const TODAY_START_TIMES = [
  "08:30",
  "09:15",
  "10:00",
  "10:45",
  "11:30",
  "13:00",
  "13:45",
  "14:30",
  "15:15",
  "16:00",
];
const APPOINTMENT_DURATION_SECONDS = 1800; // 30 minutes

function addSeconds(startTime: string, seconds: number): string {
  const [hours, minutes] = startTime.split(":").map(Number);
  const total = (hours || 0) * 3600 + (minutes || 0) * 60 + seconds;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:00`;
}

/**
 * A full schedule for the current day, regardless of what day it is: one
 * appointment per roster patient, at least the first half marked "In exam room"
 * (pc_apptstatus "<") so a demo always has roomed patients to chart and
 * getNextAppointment always finds a next patient.
 */
function buildTodaySchedule(): Appointment[] {
  const today = localDatePlusDays(0);
  const roomedCount = Math.ceil(SEEDS.length / 2);
  return SEEDS.map((seed, index) => {
    const startTime = TODAY_START_TIMES[index % TODAY_START_TIMES.length];
    // First half roomed ("<"); the rest alternate arrived ("@") / scheduled ("-").
    const status = index < roomedCount ? "<" : index % 2 === 0 ? "@" : "-";
    return {
      pc_eid: String(3000 + seed.pid),
      pc_uuid: `3c000000-0000-4000-8000-${String(3000 + seed.pid).padStart(12, "0")}`,
      fname: seed.fname,
      lname: seed.lname,
      DOB: seed.DOB,
      pid: String(seed.pid),
      puuid: seed.uuid,
      pce_aid_uuid: PROVIDER.uuid,
      pce_aid_fname: PROVIDER.fname,
      pce_aid_lname: PROVIDER.lname,
      pce_aid_npi: PROVIDER.npi,
      pc_apptstatus: status,
      pc_eventDate: today,
      pc_startTime: `${startTime}:00`,
      pc_endTime: addSeconds(startTime, APPOINTMENT_DURATION_SECONDS),
      pc_duration: String(APPOINTMENT_DURATION_SECONDS),
      pc_time: `${localDatePlusDays(-1)} 08:00:00`,
      pc_title: seed.todayReason,
      facility_name: FACILITY,
    };
  });
}

// A couple of future-dated appointments so the patient-overview "upcoming"
// section is populated for those patients.
function buildUpcomingAppointments(): Appointment[] {
  const upcoming: Array<{ seedIndex: number; days: number; time: string }> = [
    { seedIndex: 0, days: 5, time: "11:00" },
    { seedIndex: 2, days: 3, time: "14:00" },
    { seedIndex: 4, days: 9, time: "10:30" },
  ];
  return upcoming.map(({ seedIndex, days, time }) => {
    const seed = SEEDS[seedIndex];
    return {
      pc_eid: String(3500 + seed.pid),
      pc_uuid: `3f000000-0000-4000-8000-${String(3500 + seed.pid).padStart(12, "0")}`,
      fname: seed.fname,
      lname: seed.lname,
      DOB: seed.DOB,
      pid: String(seed.pid),
      puuid: seed.uuid,
      pce_aid_uuid: PROVIDER.uuid,
      pce_aid_fname: PROVIDER.fname,
      pce_aid_lname: PROVIDER.lname,
      pce_aid_npi: PROVIDER.npi,
      pc_apptstatus: "-",
      pc_eventDate: localDatePlusDays(days),
      pc_startTime: `${time}:00`,
      pc_endTime: addSeconds(time, APPOINTMENT_DURATION_SECONDS),
      pc_duration: String(APPOINTMENT_DURATION_SECONDS),
      pc_time: `${localDatePlusDays(-1)} 08:00:00`,
      pc_title: seed.todayReason,
      facility_name: FACILITY,
    };
  });
}

export const demoDataset: FixtureDataset = {
  patients,
  getAppointments: () => [
    ...buildTodaySchedule(),
    ...buildUpcomingAppointments(),
  ],
  encountersByUuid,
  soapNotesByEncounter,
  vitalsByEncounter,
  problemsByUuid,
  allergiesByUuid,
  medicationsByPid,
  surgeriesByPid,
};
