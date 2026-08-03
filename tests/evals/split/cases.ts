import { scribeEvalCases } from "../scribe/cases";
import {
  CAREGIVER_PRESENT,
  NURSE_HANDOFF_INTERPRETER,
  UNNAMED_SECOND_VISIT,
} from "./authored";

/**
 * One row of the split eval.
 *
 * The transcript is the `visits` joined with a single space, so the join
 * points ARE the ground-truth boundaries — no hand-typed offsets or anchor
 * phrases to drift as the source transcripts change. A one-visit row is the
 * false-positive side of the measurement, not a degenerate case: single-visit
 * recordings are the overwhelming majority of real traffic.
 */
export type SplitEvalCase = {
  id: string;
  /** The patient the session was started for — visit 1's patient, as the real
   * client always passes. */
  currentPatientName: string;
  visits: {
    transcript: string;
    /** The name as actually spoken in that visit; "" when never spoken. */
    patientName: string;
  }[];
  /** What this row probes. Shown in the evalite UI. */
  notes: string;
};

const VISIT_JOINER = " ";

/** A source transcript from the scribe eval's clinical corpus. Referenced by
 * id rather than copied, so the two corpora can't drift apart. */
function scribeTranscript(id: string): string {
  const found = scribeEvalCases.find((row) => row.id === id);
  if (!found) {
    throw new Error(
      `No scribe eval case "${id}". Available: ${scribeEvalCases
        .map((row) => row.id)
        .join(", ")}`
    );
  }
  return found.transcript;
}

/** Every transcript in the scribe corpus speaks the patient's first name and
 * never their surname, so that's the label to expect. */
const ELEANOR = "Eleanor";
const MARCUS = "Marcus";

const visit = (id: string, patientName: string) => ({
  transcript: scribeTranscript(id),
  patientName,
});

export function transcriptOf(evalCase: SplitEvalCase): string {
  return evalCase.visits.map((row) => row.transcript).join(VISIT_JOINER);
}

/**
 * Ground-truth character intervals, one per visit, contiguous and covering the
 * whole transcript. The joiner space is counted with the visit it follows,
 * which makes the intervals adjacent — a boundary landing on it is exact,
 * not off by one.
 */
export function trueIntervals(
  evalCase: SplitEvalCase
): { start: number; end: number }[] {
  const intervals: { start: number; end: number }[] = [];
  let cursor = 0;
  evalCase.visits.forEach((row, index) => {
    const isLast = index === evalCase.visits.length - 1;
    const end =
      cursor + row.transcript.length + (isLast ? 0 : VISIT_JOINER.length);
    intervals.push({ start: cursor, end });
    cursor = end;
  });
  return intervals;
}

export const splitEvalCases: SplitEvalCase[] = [
  // ── Single visit: the false-positive side, and most real traffic ──────────
  {
    id: "single-noisy-ambient",
    currentPatientName: "Eleanor Vance",
    visits: [visit("noisy-ambient-audio", ELEANOR)],
    notes:
      "The natural trap in the corpus: heavy small talk, a mid-transcript " +
      "'So what brought you in?', a mid-visit topic pivot ('Oh, while I'm " +
      "here — I noticed this bruise'), and a closing. Every one of those is a " +
      "surface cue the prompt lists as NOT a boundary.",
  },
  {
    id: "single-referral-multi",
    currentPatientName: "Marcus Webb",
    visits: [visit("referral-multi", MARCUS)],
    notes:
      "Several body systems in one visit and two other providers named. " +
      "Naming a third party must not read as a change of patient.",
  },
  {
    id: "single-new-problem-new-med",
    currentPatientName: "Eleanor Vance",
    visits: [visit("new-problem-new-med", ELEANOR)],
    notes: "An ordinary single visit — the baseline the majority looks like.",
  },
  {
    id: "single-med-discontinuation",
    currentPatientName: "Eleanor Vance",
    visits: [visit("med-discontinuation", ELEANOR)],
    notes: "Ordinary single visit, opens mid-conversation with no greeting.",
  },
  {
    id: "single-no-follow-up",
    currentPatientName: "Marcus Webb",
    visits: [visit("no-follow-up-needed", MARCUS)],
    notes:
      "Single visit that ends on a discharge-style closing with no follow-up " +
      "booked — a closing with nothing after it is not a boundary.",
  },
  {
    id: "single-no-vitals",
    currentPatientName: "Marcus Webb",
    visits: [visit("no-vitals-stated", MARCUS)],
    notes: "Single visit with no vitals spoken; history-taking heavy.",
  },

  // ── Two visits: the bug this feature exists for ───────────────────────────
  {
    id: "pair-eleanor-marcus",
    currentPatientName: "Eleanor Vance",
    visits: [
      visit("new-problem-new-med", ELEANOR),
      visit("no-vitals-stated", MARCUS),
    ],
    notes: "Clean two-visit splice, closing followed by a fresh greeting.",
  },
  {
    id: "pair-marcus-eleanor",
    currentPatientName: "Marcus Webb",
    visits: [
      visit("new-rx-med", MARCUS),
      visit("med-discontinuation", ELEANOR),
    ],
    notes:
      "Reverse ordering, and visit 2 opens mid-conversation ('Come on in, " +
      "Eleanor') rather than with a formal greeting.",
  },
  {
    id: "pair-noisy-then-marcus",
    currentPatientName: "Eleanor Vance",
    visits: [
      visit("noisy-ambient-audio", ELEANOR),
      visit("no-follow-up-needed", MARCUS),
    ],
    notes:
      "The hardest pairing: visit 1 is the small-talk trap, so the model has " +
      "to ignore several false cues and still find the one real boundary.",
  },
  {
    id: "pair-referral-then-eleanor",
    currentPatientName: "Marcus Webb",
    visits: [
      visit("referral-multi", MARCUS),
      visit("medication-refill", ELEANOR),
    ],
    notes:
      "Visit 1 names other providers, visit 2 is short — the boundary sits " +
      "close to the end of the recording.",
  },
  {
    id: "pair-eleanor-referral-first",
    currentPatientName: "Eleanor Vance",
    visits: [
      visit("referral-single", ELEANOR),
      visit("no-vitals-stated", MARCUS),
    ],
    notes: "A fifth opening style, so the corpus isn't one greeting repeated.",
  },

  // ── Three visits: N > 2 is only proven by exercising it ───────────────────
  {
    id: "triple-e-m-e",
    currentPatientName: "Eleanor Vance",
    visits: [
      visit("new-problem-new-med", ELEANOR),
      visit("no-vitals-stated", MARCUS),
      visit("medication-refill", ELEANOR),
    ],
    notes:
      "Three visits, and the same patient appears twice — visits 1 and 3 are " +
      "both Eleanor, which must not collapse them into one.",
  },
  {
    id: "triple-m-e-m",
    currentPatientName: "Marcus Webb",
    visits: [
      visit("new-rx-med", MARCUS),
      visit("noisy-ambient-audio", ELEANOR),
      visit("no-follow-up-needed", MARCUS),
    ],
    notes: "Three visits with the small-talk trap in the middle.",
  },

  // ── Hand-authored: what splicing structurally can't produce ───────────────
  {
    id: "caregiver-named-present",
    currentPatientName: "Eleanor Vance",
    visits: [{ transcript: CAREGIVER_PRESENT, patientName: ELEANOR }],
    notes:
      "One visit with the patient's daughter Claire greeted at the door by " +
      "name, speaking throughout, and addressed directly. The prompt's " +
      "headline NOT-a-new-visit rule; a second named person is the strongest " +
      "false-split signal short of a real boundary.",
  },
  {
    id: "nurse-handoff-interpreter",
    currentPatientName: "Chidi Okafor",
    visits: [{ transcript: NURSE_HANDOFF_INTERPRETER, patientName: "Okafor" }],
    notes:
      "One visit containing a literal handoff ('let me get the doctor in for " +
      "you') and two named non-patients (nurse Dana, interpreter Yusuf). " +
      "Pits the 'explicit handoff talk' split rule against the 'nurse, " +
      "interpreter, student is not a new visit' rule. The patient never " +
      "changes, so the answer is one.",
  },
  {
    id: "second-patient-unnamed",
    currentPatientName: "Eleanor Vance",
    visits: [
      visit("medication-refill", ELEANOR),
      { transcript: UNNAMED_SECOND_VISIT, patientName: "" },
    ],
    notes:
      "A real second visit whose patient is never named — the boundary has " +
      "to come from the visit arc restarting, not from a name. Correct label " +
      'for segment 2 is ""; any name here is invented, and an invented name ' +
      "resolves confidently against today's calendar and charts to the wrong " +
      "record.",
  },

  // ── The pre-model floor ───────────────────────────────────────────────────
  {
    id: "below-word-floor",
    currentPatientName: "Marcus Webb",
    visits: [
      {
        // Under MIN_SPLIT_WORDS: splitTranscript must answer without calling
        // the model at all, so this row also pins the latency floor.
        transcript: scribeTranscript("medication-refill")
          .split(/\s+/)
          .slice(0, 40)
          .join(" "),
        // "" even though Eleanor is named in the text: no model runs on this
        // path, so there is nothing to label and an unlabelled segment is the
        // correct result, not a miss worth warning about.
        patientName: "",
      },
    ],
    notes:
      "Below MIN_SPLIT_WORDS — the short-circuit that keeps ordinary short " +
      "sessions from paying detection latency at all.",
  },
];
