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
  // A realistic ambient transcript for today's visit, served by the "Use demo
  // recording" shortcut (demo mode only). Consistent with this patient's
  // problem/medication/prior encounter, states a couple of vitals aloud, names a
  // concrete plan change for the scribe to chart, and mentions a follow-up.
  transcript: string;
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
    transcript: `Dr. Reyes: Morning, Eleanor, good to see you. How have things been since your last diabetes visit?
Eleanor: Pretty good overall, but I've been getting up two or three times a night to use the bathroom, and I'm thirstier than usual in the evenings.
Dr. Reyes: Okay. Are you still taking the metformin five hundred twice a day with meals?
Eleanor: Yes, every day. Though I'll admit my diet's slipped a bit over the summer.
Dr. Reyes: Let me check your numbers. Blood pressure today is one thirty-six over eighty. Weight is one sixty-eight, so up about three pounds. Your A1c came back at seven-nine, up from seven-two in the spring.
Eleanor: That's not great, is it?
Dr. Reyes: It's drifted up a little. Let's increase the metformin to one thousand milligrams twice daily and see if we can bring that back down. Keep taking it with food to avoid stomach upset. I'd also like you to cut back on the evening snacking.
Eleanor: I can do that.
Dr. Reyes: Good. Feet look fine today, no swelling. But since it's been a while, I want to get you a couple of referrals to stay ahead of the diabetes. I'm going to send you to Dr. Richard Bazarian, a retina specialist over on Marginal Way, for your annual diabetic eye exam. And I'd like Dr. Ryan Hiebert in podiatry, here in Portland, to do a thorough diabetic foot check.
Eleanor: I haven't had my eyes looked at in a while, so that's probably wise.
Dr. Reyes: It is. Let's recheck your A1c and get you back in about three months.`,
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
    transcript: `Dr. Reyes: Hi Marcus, how's the breathing been since we started the inhaled steroid?
Marcus: Honestly a lot better. The wheezing after my runs has mostly settled down. I'm only reaching for the albuterol maybe once a week now instead of every other day.
Dr. Reyes: That's a big improvement. Any nighttime symptoms or waking up short of breath?
Marcus: No, nights have been fine.
Dr. Reyes: Great. Let me listen. Lungs are clear, no wheezes today. Your oxygen saturation is ninety-nine percent, blood pressure one twenty over seventy-six. Peak flow is up to about ninety-four percent of predicted, so that's better than the eighty-eight we had last time.
Marcus: The exercise part was really what was bugging me.
Dr. Reyes: Let's keep you on the daily inhaled corticosteroid since it's clearly working, and continue the albuterol as your rescue inhaler before exercise if you need it. Make sure you're rinsing your mouth after the steroid inhaler.
Marcus: Will do.
Dr. Reyes: Since things are well controlled now, I'd like to refer you to Dr. Jessica Badlam in pulmonology, over on Colchester Avenue, for formal breathing tests — spirometry — so we have a solid baseline before we think about stepping the steroid down later.
Marcus: Makes sense to get the real numbers.
Dr. Reyes: Let's follow up in three months, and sooner if the wheezing flares up again.`,
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
    transcript: `Dr. Reyes: Good afternoon, Priya. We're here to check on your blood pressure. Have you been keeping that home log?
Priya: I have. It's been running higher than I'd like — a lot of mornings in the one forties over nineties, even though I take the lisinopril every day.
Dr. Reyes: Any headaches, chest pain, or dizziness?
Priya: No, none of that. I feel fine, it's just the numbers.
Dr. Reyes: Let's confirm here. In the office today you're one forty-four over ninety, pulse seventy-six, weight one fifty-five. Heart sounds regular. That's consistent with your home readings.
Priya: So the current dose isn't quite doing it.
Dr. Reyes: Right. You're on lisinopril ten milligrams — let's increase that to twenty milligrams once daily. Keep up the low-salt diet, it does make a difference. Watch for any lightheadedness when you stand up over the first week or two.
Priya: Okay, twenty milligrams.
Dr. Reyes: Since your pressure's been stubborn despite good adherence, I also want to bring in some specialists. I'm referring you to Dr. Christina Al Malouf, a cardiologist over on Eddy Street, to make sure the heart looks fine at these pressures. And to Dr. Rasha Alawieh in nephrology, also on Eddy Street, to check the kidneys and rule out a secondary cause.
Priya: Two specialists — should I be worried?
Dr. Reyes: Not worried, just thorough — resistant blood pressure is worth a closer look. Keep logging your morning pressures, and let's recheck in about six weeks to see how the higher dose is working.`,
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
    transcript: `Dr. Reyes: Hello James, thanks for coming in to go over your cholesterol. How have you been tolerating the atorvastatin?
James: No problems at all. No muscle aches, no cramps. I take it at night like you said.
Dr. Reyes: Good, that's what I like to hear. Any changes in diet or exercise?
James: I've actually been walking most mornings, about two miles.
Dr. Reyes: Excellent. Let me give you today's numbers. Blood pressure one twenty-six over seventy-eight, weight two hundred even, so down a pound. Your latest lipid panel shows LDL down to seventy-eight, from ninety-six last time.
James: That's the lowest it's ever been.
Dr. Reyes: It is, and it's right where we want it. The atorvastatin twenty milligrams is clearly working well, so let's continue it at the same dose and keep up the morning walks.
James: Sounds good. Do I need bloodwork again soon?
Dr. Reyes: Let's repeat the lipid panel and liver enzymes in six months, and I'll see you back then unless anything comes up.`,
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
    transcript: `Dr. Reyes: Hi Sofia, good to see you. We're checking on your thyroid today. How have your energy levels been?
Sofia: Not as good as last visit, actually. The last month or so I've felt more tired again, and I've been cold all the time even when it's warm out.
Dr. Reyes: Any changes to how you're taking the levothyroxine?
Sofia: I take it every morning, but I've started having coffee and breakfast right after, maybe within ten minutes.
Dr. Reyes: That could be part of it — taking it too close to food can reduce how much you absorb. Let me look at your labs. Your TSH came back at six-two, which is higher than our target, so your levels have drifted up.
Sofia: So I'm under-treated.
Dr. Reyes: A bit, yes. Let's increase the levothyroxine from seventy-five to eighty-eight micrograms in the morning, and give it a good thirty to sixty minutes before you eat or have coffee. Your blood pressure today is one fourteen over seventy, weight one forty-one.
Sofia: Okay, eighty-eight and wait before breakfast.
Dr. Reyes: Exactly. Since your TSH has been bouncing around, I'd also like to get you established with an endocrinologist. I'll refer you to Dr. Ipek Alpertunga over on Seymour Street to help fine-tune the dosing.
Sofia: That would be reassuring, honestly.
Dr. Reyes: Good. We'll recheck your TSH in about six weeks to make sure the new dose gets you back to target.`,
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
    transcript: `Dr. Reyes: Hello Henry, let's see how your reflux is doing. Last time the omeprazole had things well controlled.
Henry: It was, but honestly the heartburn has crept back over the past few weeks, especially at night when I lie down. A couple of times it's woken me up.
Dr. Reyes: Are you taking the omeprazole twenty milligrams before breakfast like we discussed?
Henry: I am, every morning.
Dr. Reyes: Any trouble swallowing, weight loss, or dark stools?
Henry: No, nothing like that. Just the burning.
Dr. Reyes: Okay, that's reassuring. Your abdomen is soft and non-tender today. Blood pressure is one twenty-two over seventy-eight, weight one seventy-eight. Since the nighttime symptoms are breaking through, let's step the omeprazole up to forty milligrams daily, still before breakfast. And try to avoid eating within three hours of bedtime, and raise the head of your bed a few inches.
Henry: I can try the bed thing.
Dr. Reyes: One more thing — because the reflux has been going on for a few years and it's flaring again, I want to refer you to Dr. Graham Barnard in gastroenterology, here in Worcester, for an upper endoscopy to take a look and make sure everything's healthy.
Henry: A scope, okay. Better to know.
Dr. Reyes: Exactly. Let's follow up in about eight weeks — if the higher dose controls it well, we can talk about stepping back down later.`,
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
    transcript: `Dr. Reyes: Hi Amara, we're here to talk about your migraines. How often have they been hitting lately?
Amara: More than before, that's why I wanted to come in. I'm getting them about six or seven days a month now, up from three or four. The sumatriptan still works when I take it, but I'm using it a lot.
Dr. Reyes: Are you still getting the aura beforehand with some of them?
Amara: About half the time, yeah, the visual stuff.
Dr. Reyes: And how many days a month are you taking the sumatriptan?
Amara: Probably eight or nine at this point.
Dr. Reyes: That's frequent enough that I'd like to start you on a daily preventive medication to bring the number down. Let's begin propranolol at twenty milligrams twice a day. It can also help since your blood pressure today is on the lower-normal side, one eighteen over seventy-four, so we'll watch for any lightheadedness.
Amara: So keep the sumatriptan for when one hits, and add the daily one?
Dr. Reyes: Exactly. Keep a headache diary so we can track frequency. Your neuro exam is normal today. Because the frequency's climbing, I also want to refer you to Dr. Olivia Begasse de Dhaem, a headache neurologist over on Mogan Street, to weigh in on the preventive plan.
Amara: A headache specialist sounds great, actually.
Dr. Reyes: Let's follow up in about six weeks to see if the propranolol is cutting down the migraine days.`,
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
    transcript: `Dr. Reyes: Hello Walter, how's the right knee been treating you?
Walter: Not great, to be honest. The stairs are really getting to me, and the naproxen helps but it's not lasting as long as it used to. It aches most of the day now.
Dr. Reyes: Did you get to the physical therapy we talked about last time?
Walter: I did about half the sessions, then life got in the way. The exercises did seem to help when I kept up with them.
Dr. Reyes: They're worth getting back to. Any stomach upset from the naproxen?
Walter: A little heartburn now and then.
Dr. Reyes: Let me examine it. There's crepitus in the right knee, no warmth or effusion today, range of motion is a bit limited by pain. Blood pressure one thirty-six over eighty-four, weight two hundred and one. Let's continue the naproxen five hundred as needed but take it with food, and I'll add a stomach-protecting medication, omeprazole twenty milligrams daily, since you're getting heartburn. Given the knee's getting worse, I want to refer you to Dr. Ricardo Gonzales, an orthopedic surgeon here in Manchester, to evaluate whether you'd benefit from an injection or imaging. And I'm sending you back to physical therapy — this time to Irene Anderson over on Goffs Falls Road — and I really want you to finish the course.
Walter: An orthopedist and PT both, all right. I'll commit to it this round.
Dr. Reyes: Good. Let's follow up in about six weeks to see where things stand after you've seen orthopedics.`,
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

// Canned encounter transcripts keyed by patient uuid, served by the "Use demo
// recording" shortcut in the scribe recording panel (demo mode only).
export const demoTranscriptByUuid: Record<string, string> = Object.fromEntries(
  SEEDS.map((seed) => [seed.uuid, seed.transcript])
);

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
