import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { auth } from "@/app/(auth)/auth";
import { decideStreamResume } from "@/lib/ai/resume-stream";
import { getChatById, getStreamIdsByChatId } from "@/lib/db/queries";
import { getStreamContext } from "../../route";

// Reconnect endpoint for useChat.resumeStream(): the client hits this on a
// return visit to a chat whose generation is still in flight. Resumes the
// most recent resumable stream from Redis (kept alive by consumeSseStream in
// the POST handler). Returns 204 when there is nothing to resume — no Redis,
// unknown chat, no active stream, or the stream already finished/expired.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: chatId } = await params;

  const streamContext = getStreamContext();
  const [session, chat] = await Promise.all([
    auth(),
    getChatById({ id: chatId }),
  ]);
  const streamIds = chat ? await getStreamIdsByChatId({ chatId }) : [];

  const decision = decideStreamResume({
    hasStreamContext: Boolean(streamContext),
    chat,
    requesterUserId: session?.user?.id ?? null,
    streamIds,
  });

  if (decision.kind === "forbidden") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (decision.kind === "no-content") {
    return new Response(null, { status: 204 });
  }

  // streamContext is non-null here: hasStreamContext gated the "resume" branch.
  const stream = await streamContext?.resumeExistingStream(decision.streamId);

  if (!stream) {
    return new Response(null, { status: 204 });
  }

  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS });
}
