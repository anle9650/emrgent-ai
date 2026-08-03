import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { splitTranscript } from "@/lib/ai/scribe-split-detect";

export const maxDuration = 60;

// Check whether one scribe recording holds more than one patient visit. The
// clinician can forget to stop the recorder and walk into the next room, and
// charting that whole transcript against the first patient writes a second
// patient's history into the wrong record.
//
// The request carries no pid, uuid, or chart data — mapping a spoken name to a
// record is the client's job, against today's calendar. The detection model
// itself contributes only boundaries and labels; see scribe-split-detect.ts.
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

  return NextResponse.json({
    encounters: await splitTranscript({ transcript, currentPatientName }),
  });
}
