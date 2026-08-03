import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getScribeSplitModel } from "@/lib/ai/providers";
import {
  type DetectedEncounter,
  MIN_SPLIT_WORDS,
  sliceTranscript,
  wordCount,
} from "@/lib/ai/scribe-split";
import { useMockModels } from "@/lib/constants";

export const maxDuration = 60;

// Check whether one scribe recording holds more than one patient visit. The
// clinician can forget to stop the recorder and walk into the next room, and
// charting that whole transcript against the first patient writes a second
// patient's history into the wrong record.
//
// The model contributes ONLY boundaries and labels. Every transcript string in
// the response is a verbatim slice of the request transcript (sliceTranscript
// does the cutting), so no chart write can ever contain model-rewritten
// speech. The request carries no pid, uuid, or chart data either — mapping a
// spoken name to a record is the client's job, against today's calendar.
//
// Always answers 200. A single encounter is the "no split" answer, and every
// failure path — short transcript, model error, timeout, unlocatable anchor —
// degrades to exactly that, so detection can never block charting.

const requestSchema = z.object({
  // A 2-hour recording is roughly 100k characters; the cap is slack above the
  // 50k the chat route allows for a kickoff text part.
  transcript: z.string().min(1).max(200_000),
  currentPatientName: z.string().max(200).default(""),
});

const detectionSchema = z.object({
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
const INSTRUCTIONS = `You segment one ambulatory dictation recording into the patient visits it contains. Usually that is exactly one. But a clinician sometimes forgets to stop the recorder and walks into the next patient's room, so two or more separate visits can sit back to back in one file.

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
  currentPatientName: string
): Promise<DetectedEncounter[]> {
  const { object } = await generateObject({
    model: getScribeSplitModel(),
    schema: detectionSchema,
    temperature: 0,
    maxRetries: 1,
    // Comfortably under the client's own 20s timeout (use-scribe-session), so
    // the server's fail-soft single-encounter answer actually reaches the
    // browser instead of the client giving up first. Detection runs ~2s.
    abortSignal: AbortSignal.timeout(12_000),
    instructions: INSTRUCTIONS,
    prompt: `Recorded during a visit with ${currentPatientName || "a patient"}.\n\n<transcript>\n${transcript}\n</transcript>`,
  });
  return object.encounters;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { transcript, currentPatientName } = parsed.data;

  // Too short to plausibly hold two visits — skip the call rather than pay its
  // latency on every ordinary session.
  if (wordCount(transcript) < MIN_SPLIT_WORDS) {
    return NextResponse.json({
      encounters: sliceTranscript(transcript, []),
    });
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
      : await detect(transcript, currentPatientName);
    return NextResponse.json({
      encounters: sliceTranscript(transcript, detected),
    });
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
    return NextResponse.json({ encounters: sliceTranscript(transcript, []) });
  }
}
