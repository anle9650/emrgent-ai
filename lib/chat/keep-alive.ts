// Pure decision logic backing the single-slot "keep-alive" refactor in
// hooks/use-active-chat.tsx: owning the useChat `Chat` instance so a brief
// navigation away from a streaming chat and back rebinds to the live in-process
// stream instead of falling onto the slower resumable-stream Redis relay.
//
// Kept free of React/SDK/server imports so it can be unit-tested directly
// (see tests/unit/keep-alive.test.ts), mirroring lib/ai/resume-stream.ts.

// The subset of useChat statuses that mean a generation is in flight — i.e. the
// instance is worth retaining across a detour so its stream isn't lost. Matches
// the SDK: `stop()` only acts on these two states (ai/src/ui/chat.ts).
export type ChatStreamStatus = "submitted" | "streaming" | "ready" | "error";

export function isBackgroundStreamStatus(status: ChatStreamStatus): boolean {
  return status === "streaming" || status === "submitted";
}

// A `Chat`'s onData may only feed the single shared DataStreamProvider buffer
// when that instance is the foreground chat; a background (retained) instance's
// data parts must be dropped so they can't pollute the active chat's artifact.
export function shouldAcceptDataPart(
  instanceChatId: string,
  activeChatId: string
): boolean {
  return instanceChatId === activeChatId;
}

// On a background instance finishing, drop it from the single retained slot if
// it is the one held there (its final state is now persisted; a later return
// hydrates from the server / Redis resume).
export function shouldEvictFinishedInstance(
  instanceChatId: string,
  retainedChatId: string | null
): boolean {
  return retainedChatId === instanceChatId;
}

// Whether the auto-resume reconnect should be attempted for the active binding.
// Never resume when we rebound to a still-live retained instance (it's already
// streaming in-process); otherwise defer to the existing gate (a server-backed
// chat with loaded history).
export function shouldAttemptAutoResume(input: {
  isNewChat: boolean;
  hasChatData: boolean;
  reboundToLive: boolean;
}): boolean {
  return !input.isNewChat && input.hasChatData && !input.reboundToLive;
}
