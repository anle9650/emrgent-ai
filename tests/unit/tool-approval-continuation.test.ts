import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChatMessage } from "@/lib/types";
import { isToolApprovalContinuation } from "@/lib/utils";

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

const approvalRespondedPart = {
  type: "tool-createEncounter",
  toolCallId: "call_1",
  state: "approval-responded",
  approval: { id: "appr_1", approved: false, reason: "not now" },
};

const outputDeniedPart = {
  type: "tool-createEncounter",
  toolCallId: "call_1",
  state: "output-denied",
  approval: { id: "appr_1", approved: false, reason: "not now" },
};

describe("isToolApprovalContinuation", () => {
  test("true when the last message is an assistant turn with a freshly answered approval", () => {
    const messages = [
      userMessage("create an encounter"),
      assistantMessage([approvalRespondedPart]),
    ];
    assert.equal(isToolApprovalContinuation(messages), true);
  });

  test("false for a new user message after a completed denial (regression: poisoned chat)", () => {
    const messages = [
      userMessage("create an encounter"),
      assistantMessage([
        outputDeniedPart,
        { type: "text", text: "Encounter creation was cancelled by user." },
      ]),
      userMessage("hello"),
    ];
    assert.equal(isToolApprovalContinuation(messages), false);
  });

  test("true when a user message races an unprocessed approval response", () => {
    const messages = [
      userMessage("create an encounter"),
      assistantMessage([approvalRespondedPart]),
      userMessage("actually, hold on"),
    ];
    assert.equal(isToolApprovalContinuation(messages), true);
  });

  test("false for a plain user message with no approval parts anywhere", () => {
    const messages = [
      userMessage("hi"),
      assistantMessage([{ type: "text", text: "Hello!" }]),
      userMessage("show me appointments"),
    ];
    assert.equal(isToolApprovalContinuation(messages), false);
  });

  test("false after an approved call completes (terminal output-available)", () => {
    const messages = [
      userMessage("create an encounter"),
      assistantMessage([
        {
          type: "tool-createEncounter",
          toolCallId: "call_1",
          state: "output-available",
          approval: { id: "appr_1", approved: true },
          output: { ok: true },
        },
        { type: "text", text: "Done." },
      ]),
      userMessage("thanks"),
    ];
    assert.equal(isToolApprovalContinuation(messages), false);
  });

  test("true when there are no messages yet is avoided: empty list is not a user send", () => {
    // .at(-1) is undefined -> role !== "user" -> continuation shape. The
    // client never sends an empty list; this just pins the current behavior.
    assert.equal(isToolApprovalContinuation([]), true);
  });
});
