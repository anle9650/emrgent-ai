import { transcribe } from "ai";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getTranscriptionModel } from "@/lib/ai/providers";
import { useMockModels } from "@/lib/constants";
import { SCRIBE_MOCK_TRANSCRIPT } from "@/lib/openemr/fixtures";

export const maxDuration = 60;

// Transcribe one scribe-session audio segment. The audio is processed in
// memory and never persisted — only the returned text lives on (inside the
// kickoff chat message). Segments are kept small client-side (~10 min /
// ~2.4 MB at 32 kbps opus), under the platform request-body limit.
export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }

  if (useMockModels) {
    return NextResponse.json({ text: SCRIBE_MOCK_TRANSCRIPT });
  }

  try {
    const result = await transcribe({
      model: getTranscriptionModel(),
      audio: new Uint8Array(await audio.arrayBuffer()),
    });
    return NextResponse.json({ text: result.text });
  } catch (error) {
    console.error("Transcription failed", error);
    return NextResponse.json(
      { error: "transcription_failed" },
      { status: 502 }
    );
  }
}
