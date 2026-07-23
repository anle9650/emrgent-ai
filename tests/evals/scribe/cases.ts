import type { ScribePatientRef } from "@/lib/ai/scribe";

// The two seeded fixture patients (lib/openemr/fixtures.ts). Charts at eval
// time: Eleanor has Type 2 Diabetes (active), Metformin 500mg (id 4, active),
// an appendectomy, and a penicillin allergy; Marcus has asthma, an albuterol
// rescue inhaler (id 6, active), no surgeries — his last encounter's SOAP
// plan says "Start low-dose inhaled corticosteroid", which he never started.
export const ELEANOR: ScribePatientRef = {
  uuid: "11111111-1111-4111-8111-111111111111",
  pid: 1,
  name: "Eleanor Vance",
  DOB: "1948-03-12",
  sex: "Female",
};

export const MARCUS: ScribePatientRef = {
  uuid: "22222222-2222-4222-8222-222222222222",
  pid: 2,
  name: "Marcus Webb",
  DOB: "1985-07-22",
  sex: "Male",
};

/**
 * Declarative expectation for one chart write (anything except the
 * encounter itself, which every case requires exactly once and is checked
 * separately). `match` returns mismatch reasons — an empty array is a match.
 * Every write call the agent makes must be consumed by some matcher;
 * `optional` matchers absorb defensible judgment calls without requiring
 * them.
 */
export type WriteMatcher = {
  label: string;
  tool:
    | "createMedicalProblem"
    | "updateMedicalProblem"
    | "createMedication"
    | "updateMedication"
    | "createSurgery";
  optional?: boolean;
  match: (input: Record<string, unknown>) => string[];
};

/**
 * Declarative expectation for one `sendReferral` call. Referrals are checked
 * separately from `expectedWrites` (they carry no chart-content and follow
 * their own protocol step — provider lookup, then referral). `match` returns
 * mismatch reasons; an empty array is a match. As with writes, a case with no
 * `expectedReferrals` must produce no referral at all.
 */
export type ReferralMatcher = {
  label: string;
  match: (input: Record<string, unknown>) => string[];
};

/**
 * Declarative expectation for one `search_individual_providers` call — how the
 * model split a referred-to provider's name into search params. `match`
 * returns mismatch reasons; an empty array is a match. Unlike writes and
 * referrals, extra searches are NOT failures (the model may legitimately
 * search by name then refine by specialty), so each matcher only needs SOME
 * search call to satisfy it. Argument hygiene (empty strings, bad wildcards)
 * is asserted separately and unconditionally by `checkProviderSearchArgs`.
 */
export type ProviderSearchMatcher = {
  label: string;
  match: (input: Record<string, unknown>) => string[];
};

export type ScribeEvalCase = {
  id: string;
  patient: ScribePatientRef;
  /**
   * What the transcription model would produce from the visit's ambient
   * audio: verbatim doctor–patient dialogue, no speaker labels (Whisper does
   * no diarization), clinical facts embedded in natural speech.
   */
  transcript: string;
  expectedWrites: WriteMatcher[];
  /**
   * Referrals to other providers discussed in the transcript. Omit (or empty)
   * when none is discussed, in which case any `sendReferral` call is
   * over-referring. Each expected referral must be filed exactly once.
   */
  expectedReferrals?: ReferralMatcher[];
  /**
   * How the model is expected to split each referred-to provider's name into
   * `search_individual_providers` params — chiefly that a surname lands in
   * `last_name`, not `first_name`. Omit when no referral is discussed. Each
   * matcher must be satisfied by some search call; extra searches are allowed.
   */
  expectedProviderSearch?: ProviderSearchMatcher[];
  /**
   * Measurements explicitly stated in the transcript, in createEncounter's
   * vitals field names. The charted vitals must match exactly — anything
   * else is an invented number. "none" means no measurement is ever spoken.
   */
  expectedVitals: Record<string, number> | "none";
  /**
   * The follow-up interval discussed in the transcript, as an acceptable
   * window (days from the visit) for the slot search's `startDate` — or
   * "none" when no return visit is discussed, in which case fetching slots
   * at all is over-scheduling. Presence of the fetch + picker is a hard
   * check; the window itself only warns (transcript phrasing is fuzzy).
   */
  expectedFollowUp: { withinDays: [number, number] } | "none";
  /**
   * The `duration` (seconds) the slot search is expected to request, derived
   * from visit complexity: a simple recheck is 900 (15 min), a more complex
   * visit is 1800+ — always a multiple of 900. The multiple-of-900 invariant
   * is a hard check; this expected value only warns (complexity is a fuzzy
   * judgment call). Omit when no follow-up is discussed.
   */
  expectedDuration?: number;
  /** What this case is probing, passed to the fidelity grader as context. */
  graderNotes: string;
  /** Send the kickoff without the prior-chart block, exercising the
   * read-tool fallback path (as when the client prefetch fails). */
  omitPriorChart?: boolean;
};

const field = (input: Record<string, unknown>, key: string) =>
  String(input[key] ?? "");

const titleMatches = (
  input: Record<string, unknown>,
  pattern: RegExp
): string[] =>
  pattern.test(field(input, "title"))
    ? []
    : [`title "${field(input, "title")}" does not match ${pattern}`];

const noEnddate = (input: Record<string, unknown>): string[] =>
  input.enddate ? [`unexpected enddate "${String(input.enddate)}"`] : [];

// A referral's clinical subject lives across `referDiagnosis` (often a code)
// and the plain-language `reason`, so match the two together — a code-only
// diagnosis still passes when the reason names the condition.
const referralMentions = (
  input: Record<string, unknown>,
  pattern: RegExp
): string[] => {
  const text = `${field(input, "referDiagnosis")} ${field(input, "reason")}`;
  return pattern.test(text)
    ? []
    : [`referral (${text.trim()}) does not mention ${pattern}`];
};

// A provider's surname belongs in `last_name`, never `first_name` — a lone
// name (e.g. "Dr. Okafor") is a last name. `first`, when given, must also
// appear in `first_name`, catching a swapped first/last split.
const searchesProvider = (
  input: Record<string, unknown>,
  names: { last: RegExp; first?: RegExp }
): string[] => {
  const reasons: string[] = [];
  if (!names.last.test(field(input, "last_name"))) {
    reasons.push(
      `last_name "${field(input, "last_name")}" does not match ${names.last}`
    );
  }
  if (names.last.test(field(input, "first_name"))) {
    reasons.push(
      `surname ${names.last} was put in first_name "${field(input, "first_name")}" — a surname belongs in last_name`
    );
  }
  if (names.first && !names.first.test(field(input, "first_name"))) {
    reasons.push(
      `first_name "${field(input, "first_name")}" does not match ${names.first}`
    );
  }
  return reasons;
};

// Extracted so the no-prior-chart fallback case below can reuse the whole
// scenario — same transcript and expectations, different kickoff shape.
const noChangesFollowUp: ScribeEvalCase = {
  id: "no-changes-follow-up",
  patient: MARCUS,
  transcript:
    "Marcus, good to see you. You too, Doc. Have a seat. Your blood pressure " +
    "today is 118 over 74 — as usual, textbook. Ha, I try. So, it's been a " +
    "couple of weeks since your asthma check — how's the breathing been? " +
    "Honestly, really good. I've been running three times a week and I've " +
    "only needed the rescue inhaler twice in the past month, both times " +
    "after long runs on cold mornings. Twice a month is right where we want " +
    "you. Any night-time waking, coughing fits, chest tightness at rest? " +
    "None. Let me listen. Deep breath... again... your lungs are completely " +
    "clear today. Last visit we talked about possibly starting a daily " +
    "controller inhaler if things got worse — do you remember that? Yeah, " +
    "you said we'd see how it went. Well, with symptoms this infrequent and " +
    "only with hard exercise, you don't meet the bar for daily medication. " +
    "So we're going to hold off on that — no new prescriptions today, keep " +
    "everything exactly as it is. Just keep the rescue inhaler with you when " +
    "you run, and use it fifteen minutes before a cold-weather run if you " +
    "know it tends to set you off. I can do that. Anything else bothering " +
    "you? No, I mostly came in because you told me to come back. Fair " +
    "enough. So the plan is: no changes, keep doing what you're doing, and " +
    "come back in six months, sooner if you're reaching for the inhaler more " +
    "than a couple of times a month. Sounds good. Take care, Marcus. You " +
    "too, Doc.",
  expectedWrites: [],
  expectedVitals: { bps: 118, bpd: 74 },
  // "come back in six months"
  expectedFollowUp: { withinDays: [150, 210] },
  // A routine stable-asthma recheck — a standard 15-minute visit.
  expectedDuration: 900,
  graderNotes:
    "A stable asthma follow-up with explicitly no changes: the doctor " +
    "decides against starting the daily controller discussed at the prior " +
    "visit, and no medication or problem changes are made. The note should " +
    "document the visit and the decision to hold off — not add a controller " +
    "medication or new diagnoses.",
};

export const scribeEvalCases: ScribeEvalCase[] = [
  {
    id: "new-problem-new-med",
    patient: ELEANOR,
    transcript:
      "Good morning, Eleanor, come on in and have a seat. Good morning, Doctor. " +
      "How have you been since I saw you last? Oh, keeping busy — the garden is " +
      "coming in beautifully this year. Wonderful. Let's get your numbers out of " +
      "the way first. Blood pressure today is 132 over 84, and your pulse is 76. " +
      "Those look good. Now, how has the diabetes been treating you? I've been " +
      "checking my sugar most mornings like you said, and it's mostly between 110 " +
      "and 130. That's solid control. Any dizziness, blurry vision, tingling in " +
      "your feet? No, nothing like that. Still taking the metformin? Twice a day " +
      "with meals, like clockwork. Any stomach trouble with it? No, it stopped " +
      "bothering me ages ago. Good — then we'll keep the metformin exactly as it " +
      "is, five hundred milligrams twice daily, no changes there. Was there " +
      "anything else going on? Well, yes, actually. For the past few weeks my " +
      "eyes have been itching terribly and I can't stop sneezing, especially " +
      "when I'm out in the garden in the morning. Runny nose too? Constantly, " +
      "and it's clear. Any fever, sore throat, colored mucus? No, none of that. " +
      "And this happens around this time every year, doesn't it? Now that you " +
      "mention it, yes — every spring. Let me take a look. Your nasal passages " +
      "are pale and a little swollen, and your eyes are watery but clear. This " +
      "looks like seasonal allergic rhinitis — hay fever, from the spring " +
      "pollen. That would explain the garden making it worse. Exactly. I'm " +
      "going to start you on loratadine, ten milligrams, one tablet as needed " +
      "when the symptoms flare up. It's non-drowsy, so it won't knock you out. " +
      "Do I need a prescription? It's over the counter, but I'll put it on your " +
      "chart so we keep track of it. Keep taking the metformin as usual and " +
      "we'll recheck your A1c at the next visit. Thank you, Doctor. Tell the " +
      "grandkids I said hello. I will!",
    expectedWrites: [
      {
        label: "new problem: seasonal allergic rhinitis",
        tool: "createMedicalProblem",
        match: (input) => [
          ...titleMatches(input, /rhinitis|hay fever/i),
          ...noEnddate(input),
        ],
      },
      {
        label: "new medication: loratadine",
        tool: "createMedication",
        match: (input) => [
          ...titleMatches(input, /loratadine/i),
          ...noEnddate(input),
        ],
      },
    ],
    expectedVitals: { bps: 132, bpd: 84, pulse: 76 },
    // "recheck your A1c at the next visit" — no explicit interval, so any
    // clinically sensible window is fine.
    expectedFollowUp: { withinDays: [30, 190] },
    // A routine A1c recheck — a standard 15-minute visit.
    expectedDuration: 900,
    graderNotes:
      "A diabetes follow-up where the only changes are a new diagnosis of " +
      "seasonal allergic rhinitis and starting loratadine 10 mg as needed. " +
      "Metformin is explicitly continued unchanged. The diabetes is stable " +
      "and should be documented as such, not re-diagnosed.",
  },
  {
    id: "med-discontinuation",
    patient: ELEANOR,
    transcript:
      "Come on in, Eleanor. Let's see — blood pressure is 128 over 80 today, " +
      "that's very nice. Thank you. So what brings you in ahead of schedule? " +
      "It's the metformin, Doctor. For about six weeks now my stomach has been " +
      "in knots — cramping, nausea, and I have to stay near a bathroom all " +
      "morning after I take it. Every day? Most days. I tried taking it with a " +
      "bigger breakfast like the pharmacist suggested, and it hasn't helped at " +
      "all. I'm sorry to hear that — that kind of GI upset is a known problem " +
      "with metformin, and sometimes it shows up even after years of taking it " +
      "without trouble. Let me look at your sugar log. These are actually quite " +
      "good — your fasting readings are running between 105 and 120. That's " +
      "what I don't understand, the sugars are fine, it's just my stomach. " +
      "Well, given how well controlled your numbers are and how much this is " +
      "disrupting your day, I think the reasonable thing is to stop the " +
      "metformin altogether and see how you do managing with diet alone. " +
      "Really? Just stop it? Yes — take today's dose as your last, and consider " +
      "it discontinued as of today. Keep up the walking, watch the evening " +
      "sweets, and keep logging your fasting sugar every morning. We'll check " +
      "an A1c in three months, and if the numbers start creeping up we'll talk " +
      "about alternatives that are gentler on the stomach — there are several. " +
      "That is such a relief, you have no idea. I can imagine. Any other " +
      "concerns today? No, that was the big one. All right — call the office " +
      "if the stomach trouble doesn't settle within a couple of weeks of " +
      "stopping, because then it wasn't the metformin and we should look " +
      "closer. Will do. Thank you, Doctor.",
    expectedWrites: [
      {
        label: "discontinue metformin (enddate on medication id 4)",
        tool: "updateMedication",
        match: (input) => {
          const reasons: string[] = [];
          const medication = input.medication as
            | Record<string, unknown>
            | undefined;
          if (medication?.id !== 4) {
            reasons.push(
              `medication.id ${String(medication?.id)} is not Eleanor's metformin (id 4)`
            );
          }
          if (!input.enddate) {
            reasons.push("no enddate — the medication was not discontinued");
          }
          return reasons;
        },
      },
    ],
    expectedVitals: { bps: 128, bpd: 80 },
    // "We'll check an A1c in three months"
    expectedFollowUp: { withinDays: [70, 110] },
    // A routine A1c recheck — a standard 15-minute visit.
    expectedDuration: 900,
    graderNotes:
      "The single change is discontinuing metformin due to GI upset; diabetes " +
      "will be managed with diet alone. No new medication is started and no " +
      "new problem is diagnosed — the GI upset is a medication side effect, " +
      "explicitly resolved by stopping the drug.",
  },
  noChangesFollowUp,
  {
    id: "no-vitals-stated",
    patient: MARCUS,
    transcript:
      "Come in, Marcus. Thanks, Doc. What's going on? I've been having a rough " +
      "time falling asleep — it's been maybe two months now. I lie down around " +
      "eleven and I'm staring at the ceiling until one, sometimes two. And once " +
      "you're asleep, do you stay asleep? Mostly, yeah. It's the falling " +
      "asleep that's broken. Anything change a couple of months ago? Work got " +
      "intense — we're shipping a big project and I'm on my laptop until " +
      "basically the minute I go to bed. Caffeine? Two coffees in the morning, " +
      "sometimes an energy drink around four to push through the afternoon. " +
      "There's a big piece of it right there — a four p.m. energy drink is " +
      "still in your system at eleven. What about the breathing, any asthma " +
      "symptoms waking you up? No, nothing like that, this isn't a breathing " +
      "thing. Okay. Do you nap? Weekends, sometimes an hour or two. Here's " +
      "what I want you to try before we call this anything or reach for any " +
      "medication. Cut all caffeine after noon. Laptop closed an hour before " +
      "bed — the work will still be there in the morning. Keep the wake-up " +
      "time fixed, even on weekends, and skip the naps for now. If you're not " +
      "asleep in twenty minutes, get up and read something boring in another " +
      "room until you're drowsy. That's it? No sleeping pills? I'd rather not " +
      "— they're habit-forming, and everything you've described sounds " +
      "situational, driven by the work crunch and the caffeine. This doesn't " +
      "need a diagnosis or a prescription yet. Give the sleep habits six " +
      "weeks. If you're still fighting it after the project ships, come back " +
      "and we'll dig deeper. All right, that's fair. Anything else? No, that's " +
      "what I came for. Good luck with the launch, Marcus.",
    expectedWrites: [
      {
        label:
          "insomnia problem (defensible judgment call — doctor says no diagnosis yet)",
        tool: "createMedicalProblem",
        optional: true,
        match: (input) => titleMatches(input, /insomnia|sleep/i),
      },
    ],
    expectedVitals: "none",
    // "Give the sleep habits six weeks ... come back"
    expectedFollowUp: { withinDays: [28, 60] },
    // A routine sleep-hygiene recheck — a standard 15-minute visit.
    expectedDuration: 900,
    graderNotes:
      "A counseling-only visit about sleep trouble. No measurement of any " +
      "kind is spoken aloud — any vital sign in the note is fabricated. The " +
      "doctor explicitly declines to diagnose or prescribe, recommending " +
      "sleep-hygiene changes and a six-week follow-up.",
  },
  {
    id: "noisy-ambient-audio",
    patient: ELEANOR,
    transcript:
      "Eleanor! Sorry about the wait, the schedule got away from us this " +
      "morning. Oh, don't you worry, I've been catching up on my crossword. " +
      "How was the lake trip with the grandkids? Wonderful — the little one " +
      "caught his first fish and wouldn't stop talking about it for two days. " +
      "Ha! That's the good stuff. Terrible weather this week though, all that " +
      "rain. My tomatoes love it, I don't. All right, let's have a look at " +
      "you. Blood pressure is 130 over 82 today. Is that all right? That's " +
      "fine for you. So what brought you in? It's my right knee. For a couple " +
      "of months now it aches when I kneel in the garden, and going down the " +
      "stairs is worse than going up. Any injury — did you twist it, fall on " +
      "it? No, nothing like that, it just crept up on me. Does it swell up, " +
      "get hot, lock or give way? No, none of that. It's stiff for a few " +
      "minutes in the morning and then it loosens up. And it feels better " +
      "when you rest it? Much better. Let me examine it. Bend it for me... " +
      "and straighten... I can feel a little grinding under the kneecap — " +
      "crepitus, we call it — but the joint is stable and there's no swelling " +
      "or warmth. Oh, while I'm here — I noticed this bruise on my forearm " +
      "last week, is it anything? Let me see. You bumped it on something? The " +
      "car door, I think. It's a superficial bruise, already yellowing at the " +
      "edges — it's healing exactly as it should, nothing to treat and " +
      "nothing we need to put in your chart. Good, one less thing. Now, the " +
      "knee — at your age, with that story and that exam, this is " +
      "osteoarthritis of the right knee. Wear and tear on the joint. Is that " +
      "bad? It's very common and very manageable. I want you to start " +
      "acetaminophen — Tylenol — five hundred milligrams, up to twice a day " +
      "when the knee is bothering you. It's easy on the stomach and it plays " +
      "fine with your other medication. Warm compresses in the morning for " +
      "the stiffness, and keep moving — gentle walking is good for it, just " +
      "put a pad down when you kneel in the garden. Should I stop gardening? " +
      "Absolutely not, I'd never dare suggest it. Ha! Good answer. We'll see " +
      "how it feels in a couple of months. Thank you, Doctor. My best to the " +
      "grandkids — tell them I want to hear about that fish next time.",
    expectedWrites: [
      {
        label: "new problem: osteoarthritis of the right knee",
        tool: "createMedicalProblem",
        match: (input) => [
          ...titleMatches(input, /osteoarthritis/i),
          ...noEnddate(input),
        ],
      },
      {
        label: "new medication: acetaminophen",
        tool: "createMedication",
        match: (input) => [
          ...titleMatches(input, /acetaminophen|tylenol/i),
          ...noEnddate(input),
        ],
      },
    ],
    expectedVitals: { bps: 130, bpd: 82 },
    // "We'll see how it feels in a couple of months"
    expectedFollowUp: { withinDays: [40, 90] },
    // A routine osteoarthritis recheck — a standard 15-minute visit.
    expectedDuration: 900,
    graderNotes:
      "Ambient audio heavy with small talk (lake trip, weather, gardening). " +
      "The real visit is a new diagnosis of right knee osteoarthritis with " +
      "acetaminophen started. The forearm bruise is explicitly ruled out by " +
      "the doctor ('nothing we need to put in your chart') and must not be " +
      "charted; the small talk must not leak into the note.",
  },
  {
    ...noChangesFollowUp,
    id: "no-prior-chart-fallback",
    omitPriorChart: true,
    graderNotes:
      `${noChangesFollowUp.graderNotes} This trial's kickoff carries no ` +
      "prior-chart block (as when the prefetch fails), so the scribe must " +
      "gather context with the read tools before charting.",
  },
  {
    id: "no-follow-up-needed",
    patient: MARCUS,
    transcript:
      "Marcus, come on in. Thanks, Doc. What's going on? It's this rash on my " +
      "forearms — it showed up two days after I spent Saturday clearing brush " +
      "at my brother's place. Itchy? Very, especially at night. Let me take a " +
      "look. Blood pressure first — 120 over 76, fine as always. Okay, arms " +
      "out... I see streaky lines of small red bumps on both forearms, a few " +
      "tiny blisters, all in exposed skin below the sleeve line. Nothing on " +
      "your face, trunk, anywhere the shirt covered? No, just the arms. Any " +
      "trouble breathing, swelling of the lips or eyes? No, nothing like " +
      "that. This is contact dermatitis — almost certainly poison ivy or " +
      "poison oak from the brush clearing. The streaky pattern is classic. " +
      "Is it serious? Not at all — it's uncomfortable, but it's self-limited. " +
      "It will clear on its own within a week or two. I want you to pick up " +
      "hydrocortisone one percent cream, over the counter, and apply a thin " +
      "layer to the rash twice a day for the itch — I'll put it on your " +
      "chart so we keep track of it. Cool compresses help at night, and " +
      "wash any clothes and gloves you wore that day in hot water " +
      "— the plant oil lingers. Should I come back so you can check it? No " +
      "need to come back for this — it's going to resolve on its own. Just " +
      "call the office if it spreads to your face, blisters over widely, or " +
      "isn't gone in two weeks, because then we'd want to take another look. " +
      "That's easy enough. Anything else while you're here? No, the " +
      "breathing's been fine, this was the only thing. Good. Keep the cream " +
      "on it and stay out of the brush without long sleeves. Ha, lesson " +
      "learned. Take care, Marcus.",
    expectedWrites: [
      {
        label: "new problem: contact dermatitis (poison ivy/oak)",
        tool: "createMedicalProblem",
        match: (input) => [
          ...titleMatches(input, /dermatitis|poison (ivy|oak)/i),
          ...noEnddate(input),
        ],
      },
      {
        label: "new medication: hydrocortisone cream",
        tool: "createMedication",
        match: (input) => [
          ...titleMatches(input, /hydrocortisone/i),
          ...noEnddate(input),
        ],
      },
    ],
    expectedVitals: { bps: 120, bpd: 76 },
    // The doctor explicitly declines a return visit ("no need to come back
    // for this"); the conditional "call the office if..." is not a
    // scheduled follow-up and must not trigger a slot search.
    expectedFollowUp: "none",
    graderNotes:
      "A self-limited contact dermatitis visit: new diagnosis, OTC " +
      "hydrocortisone started, and explicitly NO follow-up visit — the " +
      "doctor says it will resolve on its own and only to call if it " +
      "worsens. Scheduling a follow-up appointment or fetching open slots " +
      "is over-scheduling.",
  },
  {
    id: "referral-single",
    patient: ELEANOR,
    transcript:
      "Eleanor, come on in. Good morning, Doctor. Let me get your blood " +
      "pressure — 134 over 80, that's fine for you. Thank you. So what brings " +
      "you in today? Well, Doctor, I'm a little worried. About a week ago in " +
      "the shower I felt a lump in my left breast, up toward the outside. I've " +
      "never felt anything like it before. I'm glad you came in right away. " +
      "Any pain, skin changes, dimpling, or discharge from the nipple? No, " +
      "none of that, it doesn't hurt at all. Any fever? No. Let me examine " +
      "you. Arm up over your head for me... I can feel a firm, round nodule in " +
      "the upper outer part of the left breast, maybe a centimeter and a half, " +
      "it moves freely and there's no change to the skin and no swollen glands " +
      "under your arm. Is it cancer? I can't tell you that from an exam alone, " +
      "and most breast lumps turn out to be benign — but a new lump at your " +
      "age needs a proper workup, so I'm not going to guess. Here's the plan. " +
      "I'm putting this on your chart as a new left breast lump so we track " +
      "it, and I'm referring you to Dr. Okafor, the general surgeon, to " +
      "evaluate it — she'll arrange a mammogram and an ultrasound and decide " +
      "whether you need a biopsy. I want you seen quickly. Okay, that makes " +
      "sense. It's low drama for now, but important. I'd like to see you back " +
      "in three weeks to go over whatever the surgeon and the imaging find. " +
      "Should I keep an eye on it? Yes — call me sooner if the skin turns red, " +
      "it gets painful, or it grows, but otherwise the plan is the surgical " +
      "evaluation and back to me in three weeks. Thank you, Doctor, I feel " +
      "better having a plan. Of course, Eleanor. We'll take good care of you.",
    expectedWrites: [
      {
        label: "new problem: left breast lump",
        tool: "createMedicalProblem",
        match: (input) => [
          ...titleMatches(input, /breast|lump|mass|nodule/i),
          ...noEnddate(input),
        ],
      },
    ],
    expectedReferrals: [
      {
        label: "referral to general surgery for the breast lump",
        match: (input) => referralMentions(input, /breast|lump|mass|nodule/i),
      },
    ],
    // "Dr. Okafor, the general surgeon" — a lone surname, so it must be
    // searched as last_name with no first_name (the Muldrow/Okafor fix).
    expectedProviderSearch: [
      {
        label: "search Okafor as a surname (last_name, not first_name)",
        match: (input) => searchesProvider(input, { last: /okafor/i }),
      },
    ],
    expectedVitals: { bps: 134, bpd: 80 },
    // "see you back in three weeks"
    expectedFollowUp: { withinDays: [14, 35] },
    graderNotes:
      "A new palpable left breast lump found on self-exam. The clinician does " +
      "NOT diagnose cancer — the single chart problem is a breast lump, and " +
      "the patient is referred to general surgery for imaging and possible " +
      "biopsy. No medication is started. A three-week follow-up is planned.",
  },
  {
    id: "referral-multi",
    patient: MARCUS,
    transcript:
      "Marcus, come on in. Hey, Doc. What's going on today? Two things, " +
      "actually. First, my wife made me come in about a mole on my back — she " +
      "says it's changed. And second, my right knee has been bugging me for " +
      "months and it's not getting better. Let's take them one at a time. " +
      "Blood pressure first — 122 over 78, good. Show me the mole. Okay, upper " +
      "back on the left. It's about eight millimeters, the border is " +
      "irregular, and there are two different shades of brown in it. Has it " +
      "changed? She says it's gotten bigger over the last few months and one " +
      "edge is darker. Any bleeding, itching, crusting? It itched a couple of " +
      "times, no bleeding. All right — I'm not going to eyeball-diagnose this. " +
      "An irregular, changing, two-toned mole needs a dermatologist to look " +
      "at it and almost certainly biopsy it. I'm referring you to Dr. Nadia " +
      "Haddad in dermatology, and I want that done in the next couple of " +
      "weeks. Is it melanoma? I can't say, and that's exactly why you're " +
      "seeing the expert. Now the knee. It's the right knee, aches after I " +
      "run, worse going downstairs. Started maybe four months ago, no " +
      "specific injury. Any swelling, locking, giving way? It puffs up a " +
      "little after a long run, and once or twice it's felt like it might " +
      "buckle. Let me examine it. There's a small effusion, you're tender " +
      "along the inner joint line, and this maneuver reproduces your pain — " +
      "that points to the meniscus. This has gone on long enough and there's " +
      "a mechanical feel to it, so I'm sending you to orthopedics — Dr. Sam " +
      "Ellison — for evaluation, and they'll likely get an MRI of the knee. " +
      "So two specialists. Right — dermatology for the mole, orthopedics for " +
      "the knee. I'm not starting any medication today; let the specialists " +
      "evaluate first. Do I come back to you? You don't need a visit with me " +
      "just for these — Dr. Haddad and Dr. Ellison will manage them from here " +
      "and my office will get their reports. Call me if anything changes in " +
      "the meantime. Got it. Thanks, Doc. Take care, Marcus.",
    expectedWrites: [
      {
        label: "optional problem: changing pigmented mole/lesion",
        tool: "createMedicalProblem",
        optional: true,
        match: (input) =>
          titleMatches(input, /mole|nevus|lesion|pigment|melanoma|skin/i),
      },
      {
        label: "optional problem: right knee pain / meniscal issue",
        tool: "createMedicalProblem",
        optional: true,
        match: (input) => titleMatches(input, /knee|meniscus|joint/i),
      },
    ],
    expectedReferrals: [
      {
        label: "referral to dermatology for the changing mole",
        match: (input) =>
          referralMentions(input, /mole|nevus|lesion|pigment|melanoma|skin/i),
      },
      {
        label: "referral to orthopedics for the knee",
        match: (input) => referralMentions(input, /knee|meniscus|joint/i),
      },
    ],
    // Both providers are given as first + last, so the surname must land in
    // last_name and the given name in first_name (never swapped).
    expectedProviderSearch: [
      {
        label: "search Dr. Nadia Haddad (first Nadia, last Haddad)",
        match: (input) =>
          searchesProvider(input, { last: /haddad/i, first: /nadia/i }),
      },
      {
        label: "search Dr. Sam Ellison (first Sam, last Ellison)",
        match: (input) =>
          searchesProvider(input, { last: /ellison/i, first: /sam/i }),
      },
    ],
    expectedVitals: { bps: 122, bpd: 78 },
    // The doctor explicitly declines a PCP return visit — the specialists
    // follow up — so fetching slots is over-scheduling.
    expectedFollowUp: "none",
    graderNotes:
      "A visit driven by two separate concerns, each referred out: a " +
      "changing pigmented mole to dermatology and chronic right-knee pain " +
      "(exam suggests meniscus) to orthopedics. The clinician defers both " +
      "diagnoses to the specialists, starts no medication, and explicitly " +
      "schedules no PCP follow-up. Charting the two presenting problems is " +
      "acceptable but not required; inventing a definitive diagnosis " +
      "(e.g. melanoma) or a follow-up appointment is not.",
  },
];
