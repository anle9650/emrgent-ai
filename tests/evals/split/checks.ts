import type { SplitEncounter } from "@/lib/ai/scribe-split";
import { type SplitEvalCase, transcriptOf, trueIntervals } from "./cases";

// Deterministic comparison of what splitTranscript produced against the
// ground truth a spliced case carries by construction. No LLM judge: the
// number of visits in a transcript we assembled ourselves is not a matter of
// opinion.

/** How much of another visit's speech a segment may carry before it counts as
 * contaminated. A boundary landing a few words early or late is survivable —
 * the scribe reads the transcript in context — but a whole exchange under the
 * wrong patient's name is the wrong-chart bug. */
const MAX_CONTAMINATION_WORDS = 10;

/** A label token this short ("Jo", "Dr") isn't distinctive enough to call a
 * hallucination on. */
const MIN_LABEL_TOKEN = 3;

type Interval = { start: number; end: number };

const words = (text: string) =>
  text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Recover each segment's position in the source transcript.
 *
 * sliceTranscript trims its segments, so their offsets aren't handed back —
 * but every segment is a verbatim slice, so a forward-only indexOf finds each
 * one exactly. A miss means the segment is NOT verbatim, which is the
 * invariant the whole feature rests on; the caller reports that as a failure
 * rather than guessing.
 */
export function producedIntervals(
  encounters: SplitEncounter[],
  transcript: string
): Interval[] | null {
  const intervals: Interval[] = [];
  let cursor = 0;
  for (const encounter of encounters) {
    const start = transcript.indexOf(encounter.text, cursor);
    if (start === -1) {
      return null;
    }
    const end = start + encounter.text.length;
    intervals.push({ start, end });
    cursor = end;
  }
  return intervals;
}

const overlap = (a: Interval, b: Interval) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * For each produced segment, the number of words in it that belong to a
 * different true visit than the one it mostly covers.
 *
 * This is the metric that matters clinically: it measures exactly how much of
 * one patient's speech would be charted under another patient's name. Note it
 * only makes sense once the counts match — with the wrong number of segments
 * the assignment is meaningless, so the count scorer is the gate.
 */
export function contamination(
  produced: Interval[],
  truth: Interval[],
  transcript: string
): { totalWords: number; detail: string[] } {
  const detail: string[] = [];
  let totalWords = 0;

  produced.forEach((segment, index) => {
    let bestVisit = 0;
    let bestOverlap = -1;
    truth.forEach((visit, visitIndex) => {
      const shared = overlap(segment, visit);
      if (shared > bestOverlap) {
        bestOverlap = shared;
        bestVisit = visitIndex;
      }
    });

    const owner = truth[bestVisit];
    const before = words(
      transcript.slice(segment.start, Math.min(segment.end, owner.start))
    );
    const after = words(
      transcript.slice(Math.max(segment.start, owner.end), segment.end)
    );
    const strayWords = before + after;
    if (strayWords > 0) {
      totalWords += strayWords;
      detail.push(
        `segment ${index + 1} (mostly visit ${bestVisit + 1}) carries ${strayWords} word(s) from an adjacent visit`
      );
    }
  });

  return { totalWords, detail };
}

/**
 * Labels, split by consequence rather than by exactness.
 *
 * A HALLUCINATED name is a failure: matchScribePatient resolves it
 * confidently against today's calendar and routes the segment to that
 * patient's chart. A MISSED name is only a warning — matchScribePatient
 * returns null, the review screen shows "Unassigned patient", and the
 * clinician picks manually.
 */
export function labelFindings(
  encounters: SplitEncounter[],
  evalCase: SplitEvalCase
): { hallucinated: string[]; warnings: string[] } {
  const hallucinated: string[] = [];
  const warnings: string[] = [];

  encounters.forEach((encounter, index) => {
    const label = encounter.patientName?.trim() ?? "";
    const expected = evalCase.visits[index]?.patientName ?? "";
    const haystack = encounter.text.toLowerCase();

    if (label === "") {
      if (expected !== "") {
        warnings.push(
          `segment ${index + 1}: no patient name reported (transcript says "${expected}")`
        );
      }
      return;
    }

    const grounded = label
      .split(/\s+/)
      .filter((token) => token.length >= MIN_LABEL_TOKEN)
      .some((token) => haystack.includes(token.toLowerCase()));
    if (grounded) {
      if (expected === "") {
        // Grounded but unexpected: a name spoken in the segment that isn't
        // the patient's (a caregiver, a nurse). Still wrong, but it's the
        // model reading the room badly rather than inventing text.
        warnings.push(
          `segment ${index + 1}: reported "${label}" for a visit whose patient is never named`
        );
      } else if (
        !haystack.includes(expected.toLowerCase()) ||
        !label.toLowerCase().includes(expected.toLowerCase())
      ) {
        warnings.push(
          `segment ${index + 1}: reported "${label}", expected "${expected}"`
        );
      }
      return;
    }

    hallucinated.push(
      `segment ${index + 1}: reported "${label}", which is spoken nowhere in that segment`
    );
  });

  return { hallucinated, warnings };
}

/** The feature's core invariant, re-asserted against live model output: every
 * segment is a verbatim slice, and together they account for the whole
 * transcript — nothing dropped, nothing invented. */
export function verbatimFindings(
  encounters: SplitEncounter[],
  transcript: string
): string[] {
  const failures: string[] = [];
  if (producedIntervals(encounters, transcript) === null) {
    failures.push(
      "a segment is not a verbatim slice of the transcript (not found by forward search)"
    );
  }
  const rejoined = collapseWhitespace(
    encounters.map((encounter) => encounter.text).join(" ")
  );
  if (rejoined !== collapseWhitespace(transcript)) {
    failures.push(
      "the segments do not rejoin to the input transcript — text was dropped or duplicated"
    );
  }
  return failures;
}

export type SplitCheckResult = {
  expectedCount: number;
  detectedCount: number;
  countPass: boolean;
  boundaryPass: boolean;
  boundaryDetail: string[];
  contaminationWords: number;
  verbatimPass: boolean;
  verbatimFailures: string[];
  hallucinatedLabels: string[];
  warnings: string[];
};

export function checkSplitRun(
  evalCase: SplitEvalCase,
  encounters: SplitEncounter[]
): SplitCheckResult {
  const transcript = transcriptOf(evalCase);
  const truth = trueIntervals(evalCase);
  const expectedCount = evalCase.visits.length;
  const detectedCount = encounters.length;
  const countPass = detectedCount === expectedCount;

  const verbatimFailures = verbatimFindings(encounters, transcript);
  const produced = producedIntervals(encounters, transcript);
  const { hallucinated, warnings } = labelFindings(encounters, evalCase);

  // Boundary placement is only meaningful against a matching segment count;
  // with the wrong count the count scorer already carries the finding.
  const contaminated =
    countPass && produced
      ? contamination(produced, truth, transcript)
      : { totalWords: 0, detail: [] };

  return {
    expectedCount,
    detectedCount,
    countPass,
    boundaryPass: contaminated.totalWords <= MAX_CONTAMINATION_WORDS,
    boundaryDetail: contaminated.detail,
    contaminationWords: contaminated.totalWords,
    verbatimPass: verbatimFailures.length === 0,
    verbatimFailures,
    hallucinatedLabels: hallucinated,
    warnings,
  };
}
