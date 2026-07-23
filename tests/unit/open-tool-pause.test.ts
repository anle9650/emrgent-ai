import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChatMessage } from "@/lib/types";
import { messageHasOpenToolPause } from "@/lib/utils";

// Minimal message factory — only the fields the predicate reads.
function assistant(parts: unknown[]): ChatMessage {
  return { id: "m1", role: "assistant", parts } as unknown as ChatMessage;
}

describe("messageHasOpenToolPause", () => {
  test("assistant with an approval-requested tool part -> true", () => {
    const msg = assistant([
      {
        type: "tool-createMedicalProblem",
        toolCallId: "t1",
        state: "approval-requested",
      },
    ]);
    assert.equal(messageHasOpenToolPause(msg), true);
  });

  test("assistant with an interactive client tool at input-available -> true", () => {
    const msg = assistant([
      {
        type: "tool-selectAppointmentSlot",
        toolCallId: "t1",
        state: "input-available",
      },
    ]);
    assert.equal(messageHasOpenToolPause(msg), true);
  });

  test("assistant with a non-interactive server tool at input-available -> false", () => {
    // A regular server tool merely passing through input-available is not a
    // pause the user has to resolve — must not over-match.
    const msg = assistant([
      {
        type: "tool-searchPatients",
        toolCallId: "t1",
        state: "input-available",
      },
    ]);
    assert.equal(messageHasOpenToolPause(msg), false);
  });

  test("assistant with terminal tool states -> false", () => {
    for (const state of [
      "output-available",
      "output-denied",
      "approval-responded",
    ]) {
      const msg = assistant([
        { type: "tool-createMedicalProblem", toolCallId: "t1", state },
      ]);
      assert.equal(messageHasOpenToolPause(msg), false, `state=${state}`);
    }
  });

  test("assistant with only text parts -> false", () => {
    const msg = assistant([{ type: "text", text: "hello" }]);
    assert.equal(messageHasOpenToolPause(msg), false);
  });

  test("user message -> false", () => {
    const msg = {
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    } as unknown as ChatMessage;
    assert.equal(messageHasOpenToolPause(msg), false);
  });

  test("assistant with a paused part among terminal ones -> true", () => {
    const msg = assistant([
      {
        type: "tool-updateMedication",
        toolCallId: "t1",
        state: "output-available",
      },
      {
        type: "tool-createEncounter",
        toolCallId: "t2",
        state: "approval-requested",
      },
    ]);
    assert.equal(messageHasOpenToolPause(msg), true);
  });
});
