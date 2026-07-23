import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideStreamResume } from "@/lib/ai/resume-stream";

const OWNER = "user-owner";
const OTHER = "user-other";

function privateChat() {
  return { visibility: "private", userId: OWNER };
}

function publicChat() {
  return { visibility: "public", userId: OWNER };
}

describe("decideStreamResume", () => {
  test("no stream context (no Redis) -> no-content", () => {
    const decision = decideStreamResume({
      hasStreamContext: false,
      chat: privateChat(),
      requesterUserId: OWNER,
      streamIds: ["s1"],
    });
    assert.deepEqual(decision, { kind: "no-content" });
  });

  test("no chat row -> no-content", () => {
    const decision = decideStreamResume({
      hasStreamContext: true,
      chat: null,
      requesterUserId: OWNER,
      streamIds: [],
    });
    assert.deepEqual(decision, { kind: "no-content" });
  });

  test("private chat, requester is not the owner -> forbidden", () => {
    const decision = decideStreamResume({
      hasStreamContext: true,
      chat: privateChat(),
      requesterUserId: OTHER,
      streamIds: ["s1"],
    });
    assert.deepEqual(decision, { kind: "forbidden" });
  });

  test("private chat, anonymous requester -> forbidden", () => {
    const decision = decideStreamResume({
      hasStreamContext: true,
      chat: privateChat(),
      requesterUserId: null,
      streamIds: ["s1"],
    });
    assert.deepEqual(decision, { kind: "forbidden" });
  });

  test("private chat, requester is the owner -> resumes", () => {
    const decision = decideStreamResume({
      hasStreamContext: true,
      chat: privateChat(),
      requesterUserId: OWNER,
      streamIds: ["s1"],
    });
    assert.deepEqual(decision, { kind: "resume", streamId: "s1" });
  });

  test("public chat, non-owner -> resumes (visibility gate is private-only)", () => {
    const decision = decideStreamResume({
      hasStreamContext: true,
      chat: publicChat(),
      requesterUserId: OTHER,
      streamIds: ["s1"],
    });
    assert.deepEqual(decision, { kind: "resume", streamId: "s1" });
  });

  test("empty streamIds -> no-content", () => {
    const decision = decideStreamResume({
      hasStreamContext: true,
      chat: privateChat(),
      requesterUserId: OWNER,
      streamIds: [],
    });
    assert.deepEqual(decision, { kind: "no-content" });
  });

  test("multiple streamIds -> resumes the most recent (last, asc by createdAt)", () => {
    const decision = decideStreamResume({
      hasStreamContext: true,
      chat: privateChat(),
      requesterUserId: OWNER,
      streamIds: ["oldest", "middle", "newest"],
    });
    assert.deepEqual(decision, { kind: "resume", streamId: "newest" });
  });
});
