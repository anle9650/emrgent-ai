// Pure decision logic backing the GET /api/chat/[id]/stream reconnect handler.
// Kept free of db/auth/server-only imports so it can be unit-tested directly
// (see tests/unit/resume-stream.test.ts), mirroring lib/openemr/availability.ts.

export type ResumeDecision =
  | { kind: "no-content" } // → 204: nothing to resume
  | { kind: "forbidden" } // → 403: private chat, not the owner
  | { kind: "resume"; streamId: string }; // → resumeExistingStream(streamId)

export function decideStreamResume(input: {
  // False when no Redis is configured (getStreamContext() returns null) — the
  // whole feature is inert without it, so there is nothing to resume.
  hasStreamContext: boolean;
  chat: { visibility: string; userId: string } | null;
  requesterUserId: string | null;
  // Stream ids for the chat, ordered asc(createdAt) — newest is the last entry.
  streamIds: string[];
}): ResumeDecision {
  const { hasStreamContext, chat, requesterUserId, streamIds } = input;

  if (!hasStreamContext) {
    return { kind: "no-content" };
  }

  if (!chat) {
    return { kind: "no-content" };
  }

  if (chat.visibility === "private" && requesterUserId !== chat.userId) {
    return { kind: "forbidden" };
  }

  const recentStreamId = streamIds.at(-1);
  if (!recentStreamId) {
    return { kind: "no-content" };
  }

  return { kind: "resume", streamId: recentStreamId };
}
