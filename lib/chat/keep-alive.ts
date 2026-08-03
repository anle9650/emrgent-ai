// Pure decision logic backing the "keep-alive" refactor in
// hooks/use-active-chat.tsx: owning the useChat `Chat` instance so a brief
// navigation away from a streaming chat and back rebinds to the live in-process
// stream instead of falling onto the slower resumable-stream Redis relay.
//
// Live-but-not-foreground instances are held in a map keyed by chat id, with
// two sources: the chat the user just navigated away from mid-stream, and a
// scribe split's extra sessions, which start detached and are never foreground
// until opened. Keying by id is what keeps those independent — an earlier
// single-slot version let the departing chat evict a detached one.
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
// when that instance is the foreground chat; a background instance's data parts
// must be dropped so they can't pollute the active chat's artifact.
export function shouldAcceptDataPart(
  instanceChatId: string,
  activeChatId: string
): boolean {
  return instanceChatId === activeChatId;
}

// On a background instance finishing, drop it from the map if it's held there
// (its final state is now persisted; a later visit hydrates from the server /
// Redis resume). Same policy as the earlier single slot, widened to the map.
export function shouldEvictFinishedInstance(
  instanceChatId: string,
  backgroundChatIds: Iterable<string>
): boolean {
  for (const id of backgroundChatIds) {
    if (id === instanceChatId) {
      return true;
    }
  }
  return false;
}

// Cap on live background instances. Must stay at or above the largest number
// of extra sessions one scribe split can start (the detection schema allows 5
// encounters, so 4 beyond the foreground one), or a maximal split would evict
// its own sessions before the clinician reached them.
export const MAX_BACKGROUND_CHATS = 4;

// Which background entries to drop once a new one is added. Insertion-ordered,
// oldest first — the same order a Map iterates.
export function backgroundChatsToEvict(
  backgroundChatIds: string[],
  max: number = MAX_BACKGROUND_CHATS
): string[] {
  const overflow = backgroundChatIds.length - max;
  return overflow > 0 ? backgroundChatIds.slice(0, overflow) : [];
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
