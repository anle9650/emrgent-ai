// Pure logic behind the scribe split check (/api/scribe/split): locating
// encounter boundaries in a recorded transcript, and auto-suggesting which
// patient an extra encounter belongs to from today's calendar.
//
// The clinician can forget to stop the recorder and walk into the next
// patient's room, so one transcript ends up holding two or more visits. The
// detection model reports only *where* each visit starts (a verbatim anchor)
// plus labels; this module applies those anchors to the real transcript. The
// invariant that matters clinically: every returned segment is a verbatim
// slice of the input, so no chart write can ever contain model-rewritten
// speech.
//
// Kept free of React/SDK/server imports so it can be unit-tested directly
// (see tests/unit/scribe-split.test.ts), mirroring lib/chat/keep-alive.ts.

import {
  type ScribeSelection,
  selectionFromAppointment,
} from "@/lib/ai/scribe";
import type { Appointment } from "@/lib/openemr/types";

/** One encounter as the detection model reports it — metadata only. The model
 * never returns clinical text; `startsWith` is a verbatim anchor used to
 * locate the boundary in the real transcript. */
export type DetectedEncounter = {
  startsWith: string;
  /** The name as spoken in that segment; "" when never spoken. */
  patientName: string;
  chiefComplaint: string;
};

/** One encounter after the boundaries have been applied. `text` is a verbatim
 * slice of the input transcript — never model-generated. */
export type SplitEncounter = {
  text: string;
  patientName: string | null;
  chiefComplaint: string;
};

/** Below this the split check is skipped outright: a recording this short
 * cannot plausibly hold two visits, and the call would be pure latency. */
export const MIN_SPLIT_WORDS = 80;

/** A segment shorter than this isn't a visit — it's a mis-placed boundary.
 * The boundary that produced it is dropped and its text stays with the
 * preceding segment. */
const MIN_SEGMENT_WORDS = 25;

/** Progressively shorter word prefixes of an anchor to try when the full
 * anchor isn't found — transcription wobble tends to hit the tail of a long
 * quote, so the opening words are the reliable part. The floor is five words:
 * enough to carry a greeting plus a name (the distinctive part of a visit
 * opening) without matching so loosely that it lands on the wrong sentence.
 * A slightly mis-placed boundary is survivable anyway — the segment word
 * floor below discards the degenerate cases. */
const ANCHOR_PREFIX_WORDS = [20, 14, 10, 7, 5];

const PUNCTUATION = /[^\p{L}\p{N}\s]/u;
const WHITESPACE = /\s/;

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function firstWords(text: string, count: number): string {
  return text.trim().split(/\s+/).slice(0, count).join(" ");
}

/** A casing/punctuation/whitespace-insensitive view of a string, with an
 * offset map back into the original so a normalized hit still yields an exact
 * original index — that's what keeps the slices verbatim. */
type Normalized = { text: string; offsets: number[] };

function normalize(source: string): Normalized {
  const chars: string[] = [];
  const offsets: number[] = [];
  let lastWasSpace = true; // suppresses a leading space

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (WHITESPACE.test(char)) {
      if (!lastWasSpace) {
        chars.push(" ");
        offsets.push(index);
        lastWasSpace = true;
      }
      continue;
    }
    if (PUNCTUATION.test(char)) {
      continue;
    }
    chars.push(char.toLowerCase());
    offsets.push(index);
    lastWasSpace = false;
  }

  return { text: chars.join(""), offsets };
}

/** Index into `normalized` of the first character at or after `originalIndex`. */
function normalizedIndexAt(normalized: Normalized, originalIndex: number) {
  for (let index = 0; index < normalized.offsets.length; index++) {
    if (normalized.offsets[index] >= originalIndex) {
      return index;
    }
  }
  return normalized.text.length;
}

/** Locate `anchor` in `transcript` at or after `fromIndex`, returning an index
 * into the ORIGINAL string (or -1). Exact match first, then the normalized
 * view, then progressively shorter word prefixes through both. */
function findAnchor(
  transcript: string,
  normalizedTranscript: Normalized,
  anchor: string,
  fromIndex: number
): number {
  const trimmed = anchor.trim();
  if (trimmed === "") {
    return -1;
  }

  const exact = transcript.indexOf(trimmed, fromIndex);
  if (exact !== -1) {
    return exact;
  }

  const normalizedAnchor = normalize(trimmed).text.trim();
  if (normalizedAnchor !== "") {
    const from = normalizedIndexAt(normalizedTranscript, fromIndex);
    const hit = normalizedTranscript.text.indexOf(normalizedAnchor, from);
    if (hit !== -1) {
      return normalizedTranscript.offsets[hit];
    }
  }

  const anchorWords = wordCount(trimmed);
  for (const count of ANCHOR_PREFIX_WORDS) {
    // Only worth retrying with a genuinely shorter prefix.
    if (count >= anchorWords) {
      continue;
    }
    const prefix = firstWords(trimmed, count);
    const prefixExact = transcript.indexOf(prefix, fromIndex);
    if (prefixExact !== -1) {
      return prefixExact;
    }
    const normalizedPrefix = normalize(prefix).text.trim();
    if (normalizedPrefix === "") {
      continue;
    }
    const from = normalizedIndexAt(normalizedTranscript, fromIndex);
    const hit = normalizedTranscript.text.indexOf(normalizedPrefix, from);
    if (hit !== -1) {
      return normalizedTranscript.offsets[hit];
    }
  }

  return -1;
}

function singleEncounter(
  transcript: string,
  detected: DetectedEncounter[]
): SplitEncounter[] {
  const first = detected[0];
  return [
    {
      text: transcript.trim(),
      patientName: first?.patientName?.trim() || null,
      chiefComplaint: first?.chiefComplaint ?? "",
    },
  ];
}

/**
 * Apply the detected boundaries to the real transcript.
 *
 * Boundary 0 is forced to index 0 whatever the model returned — the first
 * encounter always begins at the start of the recording. Each subsequent
 * anchor is searched for only *after* the previous boundary, so a phrase that
 * recurs later in the visit can't reorder the segments. Anchors that can't be
 * located are dropped, as are boundaries that would carve out a segment under
 * MIN_SEGMENT_WORDS; in both cases the orphaned text stays with the PRECEDING
 * segment, never the following one — merging forward would file one patient's
 * speech under the next patient's name, which is the bug this whole feature
 * exists to prevent.
 *
 * Fewer than two surviving boundaries returns a single whole-transcript
 * encounter, and the caller takes the ordinary unsplit path.
 */
export function sliceTranscript(
  transcript: string,
  detected: DetectedEncounter[]
): SplitEncounter[] {
  if (detected.length < 2 || transcript.trim() === "") {
    return singleEncounter(transcript, detected);
  }

  const normalizedTranscript = normalize(transcript);

  // Locate every boundary. Index 0 is pinned to the start of the transcript.
  const located: { index: number; encounter: DetectedEncounter }[] = [
    { index: 0, encounter: detected[0] },
  ];
  for (const encounter of detected.slice(1)) {
    const previous = located.at(-1);
    if (!previous) {
      continue;
    }
    const found = findAnchor(
      transcript,
      normalizedTranscript,
      encounter.startsWith,
      previous.index + 1
    );
    if (found > previous.index) {
      located.push({ index: found, encounter });
    }
  }

  // Drop boundaries that would produce a segment under the word floor. The
  // check is on the segment a boundary CLOSES, so dropping it extends that
  // (too-short) preceding segment rather than the following one.
  const kept = [located[0]];
  for (const boundary of located.slice(1)) {
    const previous = kept.at(-1);
    if (!previous) {
      continue;
    }
    if (
      wordCount(transcript.slice(previous.index, boundary.index)) >=
      MIN_SEGMENT_WORDS
    ) {
      kept.push(boundary);
    }
  }
  // The final segment gets the same floor; dropping its opening boundary
  // folds it back into the one before.
  while (kept.length > 1) {
    const last = kept.at(-1);
    if (!last) {
      break;
    }
    if (wordCount(transcript.slice(last.index)) >= MIN_SEGMENT_WORDS) {
      break;
    }
    kept.pop();
  }

  if (kept.length < 2) {
    return singleEncounter(transcript, detected);
  }

  return kept.map((boundary, position) => {
    const next = kept[position + 1];
    const text = transcript.slice(
      boundary.index,
      next ? next.index : undefined
    );
    return {
      text: text.trim(),
      patientName: boundary.encounter.patientName?.trim() || null,
      chiefComplaint: boundary.encounter.chiefComplaint ?? "",
    };
  });
}

function nameTokens(name: string): string[] {
  return normalize(name)
    .text.split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

const SCORE_FULL_NAME = 4;
const SCORE_LAST_NAME = 3;
const SCORE_FIRST_NAME = 2;
const SCORE_TOKEN_OVERLAP = 1;

function scoreAppointment(hintTokens: string[], appointment: Appointment) {
  const first = nameTokens(appointment.fname ?? "");
  const last = nameTokens(appointment.lname ?? "");
  const full = [...first, ...last];
  if (full.length === 0 || hintTokens.length === 0) {
    return 0;
  }

  if (
    hintTokens.length === full.length &&
    hintTokens.every((token, index) => token === full[index])
  ) {
    return SCORE_FULL_NAME;
  }
  if (last.length > 0 && last.every((token) => hintTokens.includes(token))) {
    return SCORE_LAST_NAME;
  }
  if (first.length > 0 && first.every((token) => hintTokens.includes(token))) {
    return SCORE_FIRST_NAME;
  }
  if (full.some((token) => hintTokens.includes(token))) {
    return SCORE_TOKEN_OVERLAP;
  }
  return 0;
}

/**
 * Auto-suggest the patient for an extra encounter from today's calendar.
 *
 * Returns null on no match AND on a tie: an ambiguous suggestion is worse than
 * none, because the clinician confirms every extra encounter and a plausible
 * wrong name is far likelier to be waved through than a blank one.
 *
 * `excludePids` carries the current visit's patient plus any pid already
 * assigned to an earlier encounter, so two segments of one recording can never
 * be routed into the same chart.
 */
export function matchScribePatient(
  hintName: string | null,
  appointments: Appointment[],
  excludePids: number[]
): ScribeSelection | null {
  const hintTokens = nameTokens(hintName ?? "");
  if (hintTokens.length === 0) {
    return null;
  }

  const excluded = new Set(excludePids);
  let best: Appointment | null = null;
  let bestScore = 0;
  let tied = false;

  for (const appointment of appointments) {
    if (excluded.has(Number(appointment.pid))) {
      continue;
    }
    const score = scoreAppointment(hintTokens, appointment);
    if (score === 0) {
      continue;
    }
    if (score > bestScore) {
      best = appointment;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && best && appointment.pid !== best.pid) {
      tied = true;
    }
  }

  if (!best || tied) {
    return null;
  }
  return selectionFromAppointment(best);
}
