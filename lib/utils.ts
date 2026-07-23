import type {
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO, parseISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import { INTERACTIVE_CLIENT_TOOL_PART_TYPES } from '@/lib/ai/interactive-tools';
import type { DBMessage, Document } from '@/lib/db/schema';
import { ChatbotError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatbotError(code as ErrorCode, cause);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const { code, cause } = await response.json();
      throw new ChatbotError(code as ErrorCode, cause);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatbotError('offline:chat');
    }

    throw error;
  }
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDocumentTimestampByIndex(
  documents: Document[],
  index: number,
) {
  if (!documents) { return new Date(); }
  if (index > documents.length) { return new Date(); }

  return documents[index].createdAt;
}

/** Parse an ISO-ish date string, returning null instead of an Invalid Date. */
export function parseDateSafe(date: string): Date | null {
  const parsed = parseISO(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      createdAt: formatISO(message.createdAt),
    },
  }));
}

export function getTextFromMessage(message: ChatMessage | UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { type: 'text'; text: string}).text)
    .join('');
}

/**
 * Whether a send must go to the server as a full-history tool-approval
 * continuation (`{ messages }`) instead of a normal `{ message }` send.
 *
 * Only the transient "approval-responded" state counts: it exists between the
 * user answering an approval and the server continuation processing it.
 * Terminal states ("output-available", "output-denied") mean the approval
 * round-trip already completed — matching them would misroute every later
 * send in a chat whose history contains a denied tool call.
 */
export function isToolApprovalContinuation(messages: ChatMessage[]): boolean {
  return (
    messages.at(-1)?.role !== 'user' ||
    messages.some((msg) =>
      msg.parts?.some(
        (part) => (part as { state?: string }).state === 'approval-responded',
      ),
    )
  );
}

export const DANGLING_TOOL_CALL_SKIP_REASON =
  'Skipped: a new message was sent before this was answered.';

/**
 * Whether a message part is a tool call paused awaiting user input — the exact
 * set the SQL `needsUserInput` predicate (lib/db/queries) treats as an open
 * pause: an `approval-requested` write, or an interactive client tool
 * (registry in lib/ai/interactive-tools) still at `input-available` waiting on
 * its UI-supplied output. Shared by `resolveDanglingToolCalls` (which
 * terminalizes such parts) and `messageHasOpenToolPause` (which detects them
 * for the auto-resume reconnect trigger), so the two never drift.
 */
export function isOpenToolPausePart(
  part: UIMessagePart<CustomUIDataTypes, ChatTools>,
): boolean {
  const state = (part as { state?: string }).state;
  return (
    'toolCallId' in part &&
    (state === 'approval-requested' ||
      (state === 'input-available' &&
        INTERACTIVE_CLIENT_TOOL_PART_TYPES.includes(part.type)))
  );
}

/**
 * Whether an assistant message is paused on an open tool call (see
 * `isOpenToolPausePart`). Used by the auto-resume trigger (hooks/use-auto-resume):
 * an in-flight approval/slot-picker continuation leaves the last assistant
 * message in this state in the DB, so the client must attempt a resume even
 * though the last message isn't a `user` turn.
 */
export function messageHasOpenToolPause(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.parts.some(isOpenToolPausePart);
}

/**
 * Resolve any tool call left dangling by an unanswered approval or an
 * abandoned client tool — e.g. the clinician sends a new message instead of
 * approving/denying a write, or before picking an appointment slot.
 *
 * These are exactly the parts the `needsUserInput` predicate (lib/db/queries)
 * treats as an open pause: an `approval-requested` write, or an interactive
 * client tool (registry in lib/ai/interactive-tools) still awaiting its
 * UI-supplied output at `input-available`. Left as-is, `convertToModelMessages`
 * emits their tool-call with no matching tool-result, so the AI SDK throws
 * `AI_MissingToolResultsError` the moment a later user message follows — and
 * since the part is persisted, the chat stays poisoned on every subsequent
 * send. Rewriting it to a terminal `output-denied` gives the model a clean
 * "skipped" tool result to react to, prevents the poison, and lets
 * already-poisoned chats recover. Scoping to that registry keeps the emitted
 * `output-denied` state confined to renderers that handle it, rather than
 * terminalizing a server tool merely passing through `input-available`.
 *
 * Used on both sides: the client calls it before a send so the stale
 * Approve/Deny buttons resolve to a "skipped" card, and the server calls it
 * before conversion (persisting the change) so the skip survives a reload.
 *
 * `output-denied` is deliberately chosen over `output-error`: it renders as the
 * denied card, and — unlike `output-available`/`output-error` — it triggers
 * neither `sendAutomaticallyWhen` predicate, so rewriting a still-last
 * assistant turn can never kick off a stray auto-continuation. The skip reason
 * rides on `approval.reason` (leaving `approval.approved` unset, so the SDK
 * emits no spurious approval-response), where the model reads it as the
 * tool-result's error text.
 *
 * `approval-responded` (the user answered) and all terminal states are left
 * untouched — those are handled correctly by the SDK. Changed messages are
 * returned as new objects; unchanged ones keep their identity, so callers can
 * detect what to persist by reference.
 */
export function resolveDanglingToolCalls(
  messages: ChatMessage[],
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }
    let changed = false;
    const parts = message.parts.map((part) => {
      if (isOpenToolPausePart(part)) {
        changed = true;
        const approval = (part as { approval?: Record<string, unknown> })
          .approval;
        return {
          ...part,
          state: 'output-denied',
          approval: { ...approval, reason: DANGLING_TOOL_CALL_SKIP_REASON },
        };
      }
      return part;
    });
    return changed ? ({ ...message, parts } as ChatMessage) : message;
  });
}
