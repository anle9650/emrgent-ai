import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { chunksForPrompt } from "@/lib/ai/models.mock";
import { resolveOpenEmrFixture } from "@/lib/openemr/fixtures";

const SYSTEM = {
  role: "system",
  content: "You help clinicians look up patient charts and appointments.",
} as const;

function user(text: string): LanguageModelV3Prompt[number] {
  return { role: "user", content: [{ type: "text", text }] };
}

function toolResult(
  toolCallId: string,
  toolName: string,
  value: unknown
): LanguageModelV3Prompt[number] {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "json", value: value as never },
      },
    ],
  };
}

function finishReasonOf(chunks: LanguageModelV3StreamPart[]) {
  const finish = chunks.at(-1);
  assert.equal(finish?.type, "finish");
  return finish.type === "finish" ? finish.finishReason.unified : null;
}

function toolCallOf(chunks: LanguageModelV3StreamPart[]) {
  return chunks.find((chunk) => chunk.type === "tool-call");
}

describe("scripted mock scenarios", () => {
  test("step 1: appointment prompt emits a getAppointments call", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      user("Show me the upcoming appointments"),
    ]);
    const call = toolCallOf(chunks);
    assert.equal(call?.toolName, "getAppointments");
    assert.equal(finishReasonOf(chunks), "tool-calls");
  });

  test("step 2: data tool result yields generateUI bound to its sourceToolCallId", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      user("Show me the upcoming appointments"),
      toolResult("abc", "getAppointments", {
        sourceToolCallId: "abc",
        results: [],
      }),
    ]);
    const call = toolCallOf(chunks);
    assert.equal(call?.toolName, "generateUI");
    assert.ok(call?.input.includes('"sourceToolCallId":"abc"'));
    assert.ok(call?.input.includes("AppointmentsCard"));
    assert.equal(finishReasonOf(chunks), "tool-calls");
  });

  test("step 3: generateUI result yields closing text", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      user("Show me the upcoming appointments"),
      toolResult("abc", "getAppointments", {
        sourceToolCallId: "abc",
        results: [],
      }),
      toolResult("def", "generateUI", { ok: true }),
    ]);
    assert.equal(toolCallOf(chunks), undefined);
    assert.equal(finishReasonOf(chunks), "stop");
    const text = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join("");
    assert.match(text, /upcoming appointments/);
  });

  test("patient prompt runs the searchPatients scenario", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      user("Search for patients in the system"),
    ]);
    assert.equal(toolCallOf(chunks)?.toolName, "searchPatients");
  });

  test("a second user turn resets the script", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      user("Show me the upcoming appointments"),
      toolResult("abc", "getAppointments", {
        sourceToolCallId: "abc",
        results: [],
      }),
      toolResult("def", "generateUI", { ok: true }),
      user("Any appointments next week?"),
    ]);
    assert.equal(toolCallOf(chunks)?.toolName, "getAppointments");
  });

  test("referral prompt files sendReferral, then a bound ReferralCard, then text", () => {
    const call = chunksForPrompt([
      SYSTEM,
      user("File a referral for Eleanor to dermatology"),
    ]);
    assert.equal(toolCallOf(call)?.toolName, "sendReferral");
    assert.equal(finishReasonOf(call), "tool-calls");

    const ui = chunksForPrompt([
      SYSTEM,
      user("File a referral for Eleanor to dermatology"),
      toolResult("ref", "sendReferral", {
        sourceToolCallId: "ref",
        results: {},
      }),
    ]);
    const uiCall = toolCallOf(ui);
    assert.equal(uiCall?.toolName, "generateUI");
    // The card binds to the sendReferral call's own id (copied from its
    // result's sourceToolCallId), the way a real model would.
    assert.match(String(uiCall?.input), /"sourceToolCallId":"ref"/);
    assert.match(String(uiCall?.input), /"component":"ReferralCard"/);

    const closing = chunksForPrompt([
      SYSTEM,
      user("File a referral for Eleanor to dermatology"),
      toolResult("ref", "sendReferral", {
        sourceToolCallId: "ref",
        results: {},
      }),
      toolResult("ui", "generateUI", { ok: true }),
    ]);
    assert.equal(toolCallOf(closing), undefined);
    assert.equal(finishReasonOf(closing), "stop");
  });

  test("scenario words in the system prompt alone don't trigger tools", () => {
    const chunks = chunksForPrompt([SYSTEM, user("hello")]);
    assert.equal(toolCallOf(chunks), undefined);
    const text = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join("");
    assert.match(text, /Hello! How can I help you/);
  });
});

describe("openemr fixtures", () => {
  test("patient list is enveloped and name-filterable", () => {
    const all = resolveOpenEmrFixture("/api/patient") as {
      data: { fname: string }[];
    };
    assert.equal(all.data.length, 2);
    const filtered = resolveOpenEmrFixture("/api/patient", {
      fname: "elea",
    }) as { data: { fname: string }[] };
    assert.deepEqual(
      filtered.data.map((p) => p.fname),
      ["Eleanor"]
    );
  });

  test("appointments are bare arrays, filterable by pid", () => {
    const all = resolveOpenEmrFixture("/api/appointment") as { pid: string }[];
    assert.equal(all.length, 5);
    const forMarcus = resolveOpenEmrFixture("/api/patient/2/appointment") as {
      pid: string;
    }[];
    assert.deepEqual(
      forMarcus.map((a) => a.pid),
      ["2", "2"]
    );
  });

  test("per-encounter endpoints return bare arrays", () => {
    const vitals = resolveOpenEmrFixture(
      "/api/patient/1/encounter/101/vital"
    ) as unknown[];
    assert.equal(vitals.length, 1);
    const soap = resolveOpenEmrFixture(
      "/api/patient/1/encounter/999/soap_note"
    ) as unknown[];
    assert.deepEqual(soap, []);
  });

  test("unknown paths and unknown legacy pids resolve to undefined (404)", () => {
    assert.equal(resolveOpenEmrFixture("/api/facility"), undefined);
    assert.equal(
      resolveOpenEmrFixture("/api/patient/99/medication"),
      undefined
    );
  });

  test("POST encounter returns an enveloped created id, not the GET list", () => {
    const created = resolveOpenEmrFixture(
      "/api/patient/11111111-1111-4111-8111-111111111111/encounter",
      undefined,
      "POST"
    ) as { data: { encounter: number; uuid: string } };
    assert.equal(created.data.encounter, 901);
    assert.match(created.data.uuid, /^[0-9a-f-]{36}$/);
  });

  test("POST vital and soap_note return a created row; unknown POSTs 404", () => {
    for (const leaf of ["vital", "soap_note"]) {
      const created = resolveOpenEmrFixture(
        `/api/patient/1/encounter/901/${leaf}`,
        undefined,
        "POST"
      ) as { id: number };
      assert.equal(created.id, 901);
    }
    assert.equal(
      resolveOpenEmrFixture("/api/patient", undefined, "POST"),
      undefined
    );
  });
});
