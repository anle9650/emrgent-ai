import { gateway, generateObject } from "ai";
import { z } from "zod";
import { getScribeSplitModel } from "@/lib/ai/providers";
import {
  type DetectedEncounter,
  MIN_SPLIT_WORDS,
  type SplitEncounter,
  sliceTranscript,
  wordCount,
} from "@/lib/ai/scribe-split";
import { useMockModels } from "@/lib/constants";

// The model half of the scribe split check (/api/scribe/split): deciding how
// many patient visits one recording holds. Split out of the route so it can be
// driven directly by tests/evals/split/ — the eval has to exercise the exact
// shipped prompt and pipeline, and the route itself isn't importable (it pulls
// in auth()).
//
// The model contributes ONLY boundaries and labels. Every transcript string it
// produces is a verbatim slice of the input (sliceTranscript does the cutting),
// so no chart write can ever contain model-rewritten speech.

export const detectionSchema = z.object({
  encounters: z
    .array(
      z.object({
        startsWith: z.string().min(1),
        // "" rather than nullable: some gateway providers reject `nullable`
        // in strict JSON-schema mode.
        patientName: z.string(),
        chiefComplaint: z.string(),
      })
    )
    .min(1)
    .max(5),
});

// Tuned against the live model — see the benchmark note on scribeSplitModel.
// Two things did the work, and both are easy to undo by accident:
//
// (1) "List EVERY visit" + the worked example. The characteristic failure of
//     every fast model here is NOT missing the second patient — it spots them
//     and labels the merged block with their name — but emitting a single
//     entry covering both. Framing the task as enumeration rather than
//     detection, and showing one two-visit answer, fixes that.
// (2) NOT biasing toward one visit. An earlier draft said "if unsure, return
//     exactly ONE — a false split is far worse than a missed one", and the
//     model then missed every real split. That bias is also simply wrong for
//     this feature: the clinician confirms the split before anything is
//     charted, so a false split costs one click on "It's one visit", while a
//     missed split is the wrong-chart bug the whole feature exists to prevent.
//
// tests/evals/split/ measures both properties on every run; a prompt edit that
// undoes either one shows up as a failed "Encounter count" row.
export const SPLIT_DETECTION_INSTRUCTIONS = `You segment one ambulatory dictation recording into the patient visits it contains. Usually that is exactly one. But a clinician sometimes forgets to stop the recorder and walks into the next patient's room, so two or more separate visits can sit back to back in one file.

List EVERY visit in the recording, not just the main one. If two different patients are each addressed by name, that is two visits and you must return two entries — never one entry covering both.

A new visit begins when:
- a different patient is addressed or greeted by name
- a closing ("take care", "see you in six months", "I'll send that in") is followed by a fresh greeting or introduction
- the visit arc restarts from zero: "what brings you in today", new history taking, a new chief complaint asked from scratch
- there is explicit handoff talk ("next room", "let's bring the next patient in")

These are NOT a new visit, no matter how the conversation shifts:
- a family member, caregiver, parent, interpreter, nurse, student, or chaperone speaking or being addressed by name — the PATIENT has not changed
- several complaints, problems, or body systems discussed in one visit
- a pause, phone call, interruption, or silence, then the same visit resuming
- the clinician dictating a summary or note after the patient has left

Example. Transcript: "Morning Ruth, how's the reflux? Better on the pantoprazole? Good, stay on 40. See you in six months. ... Sorry to keep you waiting, Tom. Let's look at that ankle."
Correct answer: TWO visits. The first startsWith "Morning Ruth, how's the reflux?", the second startsWith "Sorry to keep you waiting, Tom." Ruth and Tom are both patients addressed by name, so the recording covers two visits.

Output rules:
- "startsWith" must be copied VERBATIM from the transcript: the first 15 to 25 words of that visit, exactly as written, same spelling, casing, and punctuation. Never paraphrase, correct, translate, complete, or invent text.
- The first visit always begins at the very start of the transcript, so encounters[0].startsWith must be the transcript's opening words.
- Visits must be listed in transcript order and must not overlap.
- "patientName" is the name of the patient in THAT segment, or "" when it is never spoken. Never guess a name.
- "chiefComplaint" is a 3-8 word label ("hypertension follow-up", "knee pain after fall").`;

async function detect(
  transcript: string,
  currentPatientName: string,
  modelId?: string
): Promise<DetectedEncounter[]> {
  const { object } = await generateObject({
    model: modelId ? gateway.languageModel(modelId) : getScribeSplitModel(),
    schema: detectionSchema,
    temperature: 0,
    maxRetries: 1,
    // Comfortably under the client's own 20s timeout (use-scribe-session), so
    // the server's fail-soft single-encounter answer actually reaches the
    // browser instead of the client giving up first. Detection runs ~2s.
    abortSignal: AbortSignal.timeout(12_000),
    instructions: SPLIT_DETECTION_INSTRUCTIONS,
    prompt: `Recorded during a visit with ${currentPatientName || "a patient"}.\n\n<transcript>\n${transcript}\n</transcript>`,
  });
  return object.encounters;
}

/**
 * The whole server-side split pipeline minus auth and request parsing: word
 * floor, detection, and the verbatim slice.
 *
 * Never throws and never returns an empty list — a short transcript, model
 * error, timeout, or unlocatable anchor all degrade to a single whole-
 * transcript encounter, so detection can never stand between a visit and its
 * chart.
 */
export async function splitTranscript({
  transcript,
  currentPatientName,
  modelId,
}: {
  transcript: string;
  currentPatientName: string;
  /** Gateway model id override — used by the eval's model sweep. */
  modelId?: string;
}): Promise<SplitEncounter[]> {
  // Too short to plausibly hold two visits — skip the call rather than pay its
  // latency on every ordinary session.
  if (wordCount(transcript) < MIN_SPLIT_WORDS) {
    return sliceTranscript(transcript, []);
  }

  try {
    // Required lazily, as providers.ts does, so the mock module (and its
    // ai/test dependency) stays out of the production bundle.
    const detected = useMockModels
      ? (
          require("@/lib/ai/models.mock") as {
            mockScribeSplit: (text: string) => DetectedEncounter[];
          }
        ).mockScribeSplit(transcript)
      : await detect(transcript, currentPatientName, modelId);
    return sliceTranscript(transcript, detected);
  } catch (error) {
    // Never surface this as an error: the session must still be chartable.
    //
    // Log the cause, not just the thrown error. A timeout that lands during a
    // retry backoff surfaces as a bare "Delay was aborted" AbortError and hides
    // whatever made the first attempt fail — which is exactly the information
    // needed to tell "the model is slow" from "the model is rejecting this".
    const cause = (error as { cause?: unknown }).cause;
    console.error("Scribe split detection failed", {
      error,
      ...(cause ? { cause } : {}),
      words: wordCount(transcript),
    });
    return sliceTranscript(transcript, []);
  }
}
