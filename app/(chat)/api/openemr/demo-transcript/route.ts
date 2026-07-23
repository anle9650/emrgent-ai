import { auth } from "@/app/(auth)/auth";
import { useOpenEmrDemo } from "@/lib/constants";
import { demoTranscriptByUuid } from "@/lib/openemr/demo-data";

// Client-side lookup for the "Use demo recording" shortcut in the scribe
// recording panel. Serves a canned encounter transcript for a demo patient,
// only when the demo OpenEMR instance is active for this session (the flag is
// set and the session has no OpenEMR token — same gate as openemrRequest).
// GET /api/openemr/demo-transcript?uuid=<patient uuid>
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uuid = searchParams.get("uuid");

  const session = await auth();
  const demoActive = useOpenEmrDemo && !session?.openemr?.accessToken;
  if (!demoActive) {
    return Response.json({ error: "demo_not_available" }, { status: 404 });
  }

  const transcript = uuid ? demoTranscriptByUuid[uuid] : undefined;
  if (!transcript) {
    return Response.json({ error: "no_demo_transcript" }, { status: 404 });
  }

  return Response.json({ transcript });
}
