import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  convertToModelMessages,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import type { ChatMessage } from "@/lib/types";
import {
  DANGLING_TOOL_CALL_SKIP_REASON,
  resolveDanglingToolCalls,
} from "@/lib/utils";

function userMessage(text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  } as ChatMessage;
}

function assistantMessage(parts: Record<string, unknown>[]): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts,
  } as unknown as ChatMessage;
}

function hasToolResult(
  modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>,
  toolCallId: string
): boolean {
  return modelMessages.some(
    (message) =>
      message.role === "tool" &&
      Array.isArray(message.content) &&
      message.content.some(
        (part) => part.type === "tool-result" && part.toolCallId === toolCallId
      )
  );
}

const pendingApprovalPart = {
  type: "tool-createEncounter",
  toolCallId: "call_1",
  state: "approval-requested",
  approval: { id: "appr_1" },
  input: { patientId: "p1" },
};

const pendingSlotPart = {
  type: "tool-selectAppointmentSlot",
  toolCallId: "call_2",
  state: "input-available",
  input: { reason: "follow-up" },
};

describe("resolveDanglingToolCalls", () => {
  test("rewrites an unanswered approval into output-denied with a skip reason", () => {
    const [message] = resolveDanglingToolCalls([
      assistantMessage([pendingApprovalPart]),
    ]);
    const part = message.parts[0] as {
      state: string;
      approval: { id: string; reason: string; approved?: boolean };
    };
    assert.equal(part.state, "output-denied");
    assert.equal(part.approval.reason, DANGLING_TOOL_CALL_SKIP_REASON);
    // Keeps the original approval id, and never sets `approved` — otherwise the
    // SDK would emit a spurious tool-approval-response.
    assert.equal(part.approval.id, "appr_1");
    assert.equal(part.approval.approved, undefined);
  });

  test("rewrites an abandoned client-tool picker (input-available) too", () => {
    const [message] = resolveDanglingToolCalls([
      assistantMessage([pendingSlotPart]),
    ]);
    const part = message.parts[0] as {
      state: string;
      approval: { reason: string };
    };
    assert.equal(part.state, "output-denied");
    assert.equal(part.approval.reason, DANGLING_TOOL_CALL_SKIP_REASON);
  });

  test("a still-last resolved turn trips neither auto-continuation predicate", () => {
    // The reason we pick output-denied over output-available/error: rewriting a
    // still-last assistant turn must not kick off a stray auto-send. Exercise
    // the real AI SDK predicates that useChat's sendAutomaticallyWhen uses.
    const messages = resolveDanglingToolCalls([
      userMessage("create an encounter"),
      assistantMessage([{ type: "step-start" }, pendingApprovalPart]),
    ]);
    assert.equal(
      lastAssistantMessageIsCompleteWithToolCalls({ messages }),
      false
    );
    assert.equal(
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages }),
      false
    );
  });

  test("does not touch a non-interactive tool merely passing through input-available", () => {
    // input-available is a state every tool transits; only the interactive
    // client-tool registry legitimately dangles there. A server read tool must
    // be left alone so it isn't terminalized into a state its renderer treats
    // as still-in-flight.
    const serverToolInFlight = assistantMessage([
      {
        type: "tool-searchPatients",
        toolCallId: "call_srv",
        state: "input-available",
        input: { query: "smith" },
      },
    ]);
    assert.equal(
      resolveDanglingToolCalls([serverToolInFlight])[0],
      serverToolInFlight
    );
  });

  test("leaves answered approvals and terminal states untouched (by identity)", () => {
    const answered = assistantMessage([
      {
        type: "tool-createEncounter",
        toolCallId: "call_1",
        state: "approval-responded",
        approval: { id: "appr_1", approved: true },
      },
    ]);
    const done = assistantMessage([
      {
        type: "tool-createEncounter",
        toolCallId: "call_2",
        state: "output-available",
        output: { ok: true },
      },
    ]);
    const [a, d] = resolveDanglingToolCalls([answered, done]);
    // Unchanged messages keep their reference, so the route's identity check
    // writes nothing back for them.
    assert.equal(a, answered);
    assert.equal(d, done);
  });

  test("leaves user messages and plain text untouched", () => {
    const messages = [userMessage("hi")];
    assert.deepEqual(resolveDanglingToolCalls(messages), messages);
  });

  test("regression: the dangling tool call gets a tool-result, so streamText won't raise AI_MissingToolResultsError", async () => {
    // The exact poison shape: an unanswered approval persisted in history,
    // followed by a brand-new user message. Without a matching tool-result,
    // the AI SDK's message combiner throws AI_MissingToolResultsError as soon
    // as the following user message is reached.
    const poisoned = [
      userMessage("create an encounter"),
      assistantMessage([pendingApprovalPart]),
      userMessage("actually, show me the appointments instead"),
    ];

    // Raw history: the assistant tool-call has no matching tool-result.
    const raw = await convertToModelMessages(poisoned);
    assert.equal(hasToolResult(raw, "call_1"), false);

    // Sanitized history: every tool-call is answered.
    const fixed = await convertToModelMessages(
      resolveDanglingToolCalls(poisoned)
    );
    assert.equal(hasToolResult(fixed, "call_1"), true);
  });
});
