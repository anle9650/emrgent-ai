import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  backgroundChatsToEvict,
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
  test("finished instance is held in the background -> evict", () => {
    assert.equal(shouldEvictFinishedInstance("chat-a", ["chat-a"]), true);
  });

  test("found among several background chats -> evict just it", () => {
    assert.equal(
      shouldEvictFinishedInstance("chat-b", ["chat-a", "chat-b", "chat-c"]),
      true
    );
  });

  test("background holds only other chats -> keep them", () => {
    assert.equal(shouldEvictFinishedInstance("chat-a", ["chat-b"]), false);
  });

  test("nothing in the background -> nothing to evict", () => {
    assert.equal(shouldEvictFinishedInstance("chat-a", []), false);
  });
});

describe("backgroundChatsToEvict", () => {
  test("under the cap -> nothing dropped", () => {
    assert.deepEqual(backgroundChatsToEvict(["a", "b"], 4), []);
  });

  test("at the cap -> nothing dropped", () => {
    assert.deepEqual(backgroundChatsToEvict(["a", "b", "c", "d"], 4), []);
  });

  test("over the cap -> oldest first", () => {
    assert.deepEqual(backgroundChatsToEvict(["a", "b", "c", "d", "e"], 4), [
      "a",
    ]);
    assert.deepEqual(
      backgroundChatsToEvict(["a", "b", "c", "d", "e", "f"], 4),
      ["a", "b"]
    );
  });

  test("the default cap fits a maximal scribe split's extra sessions", () => {
    // The split detection schema allows 5 encounters: one foreground chat plus
    // 4 background ones, none of which may be evicted before it's opened.
    assert.deepEqual(backgroundChatsToEvict(["a", "b", "c", "d"]), []);
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
