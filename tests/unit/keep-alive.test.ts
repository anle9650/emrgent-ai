import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isBackgroundStreamStatus,
  shouldAcceptDataPart,
  shouldAttemptAutoResume,
  shouldEvictFinishedInstance,
} from "@/lib/chat/keep-alive";

describe("isBackgroundStreamStatus", () => {
  test("streaming / submitted -> true (worth retaining)", () => {
    assert.equal(isBackgroundStreamStatus("streaming"), true);
    assert.equal(isBackgroundStreamStatus("submitted"), true);
  });

  test("ready / error -> false (nothing in flight)", () => {
    assert.equal(isBackgroundStreamStatus("ready"), false);
    assert.equal(isBackgroundStreamStatus("error"), false);
  });
});

describe("shouldAcceptDataPart", () => {
  test("foreground instance -> accepted", () => {
    assert.equal(shouldAcceptDataPart("chat-a", "chat-a"), true);
  });

  test("background instance -> dropped (no cross-chat pollution)", () => {
    assert.equal(shouldAcceptDataPart("chat-a", "chat-b"), false);
  });
});

describe("shouldEvictFinishedInstance", () => {
  test("finished instance is the retained one -> evict", () => {
    assert.equal(shouldEvictFinishedInstance("chat-a", "chat-a"), true);
  });

  test("retained slot holds a different chat -> keep it", () => {
    assert.equal(shouldEvictFinishedInstance("chat-a", "chat-b"), false);
  });

  test("nothing retained -> nothing to evict", () => {
    assert.equal(shouldEvictFinishedInstance("chat-a", null), false);
  });
});

describe("shouldAttemptAutoResume", () => {
  test("rebound to a live retained instance -> never resume", () => {
    assert.equal(
      shouldAttemptAutoResume({
        isNewChat: false,
        hasChatData: true,
        reboundToLive: true,
      }),
      false
    );
  });

  test("server-backed chat, fresh (non-live) instance -> resume", () => {
    assert.equal(
      shouldAttemptAutoResume({
        isNewChat: false,
        hasChatData: true,
        reboundToLive: false,
      }),
      true
    );
  });

  test("brand-new local chat -> never resume", () => {
    assert.equal(
      shouldAttemptAutoResume({
        isNewChat: true,
        hasChatData: false,
        reboundToLive: false,
      }),
      false
    );
  });

  test("no loaded history yet -> do not resume", () => {
    assert.equal(
      shouldAttemptAutoResume({
        isNewChat: false,
        hasChatData: false,
        reboundToLive: false,
      }),
      false
    );
  });
});
