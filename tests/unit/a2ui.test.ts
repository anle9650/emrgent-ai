import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ModelMessage } from "ai";
import {
  formatValue,
  getPath,
  resolveBinding,
} from "@/components/chat/a2ui/resolve";
import {
  type A2UISpec,
  generateUiInputSchema,
  validateSurface,
} from "@/lib/ai/a2ui/schema";
import { generateUI } from "@/lib/ai/tools/generate-ui";

const validSpec: A2UISpec = {
  root: "col",
  components: [
    { id: "col", component: "Column", children: ["heading", "patients"] },
    { id: "heading", component: "Text", text: "Matches", variant: "heading" },
    {
      id: "patients",
      component: "PatientsCard",
      sourceToolCallId: "call_1",
    },
  ],
};

describe("a2ui schema", () => {
  test("accepts a valid spec", () => {
    assert.equal(generateUiInputSchema.safeParse(validSpec).success, true);
    assert.deepEqual(validateSurface(validSpec), []);
  });

  test("rejects unknown component names", () => {
    const parsed = generateUiInputSchema.safeParse({
      root: "x",
      components: [{ id: "x", component: "Iframe", src: "https://evil" }],
    });
    assert.equal(parsed.success, false);
  });

  test("flags a missing root", () => {
    const errors = validateSurface({ ...validSpec, root: "nope" });
    assert.match(errors.join(" "), /Root id "nope"/);
  });

  test("flags duplicate ids", () => {
    const errors = validateSurface({
      root: "a",
      components: [
        { id: "a", component: "Column", children: [] },
        { id: "a", component: "Divider" },
      ],
    });
    assert.match(errors.join(" "), /Duplicate component id/);
  });

  test("flags dangling child references", () => {
    const errors = validateSurface({
      root: "a",
      components: [{ id: "a", component: "Column", children: ["ghost"] }],
    });
    assert.match(errors.join(" "), /unknown child "ghost"/);
  });

  test("flags cycles", () => {
    const errors = validateSurface({
      root: "a",
      components: [
        { id: "a", component: "Column", children: ["b"] },
        { id: "b", component: "Column", children: ["a"] },
      ],
    });
    assert.match(errors.join(" "), /Cycle detected/);
  });

  test("flags components unreachable from root", () => {
    const errors = validateSurface({
      root: "a",
      components: [
        { id: "a", component: "Divider" },
        { id: "b", component: "Divider" },
      ],
    });
    assert.match(errors.join(" "), /"b" is not reachable/);
  });
});

describe("a2ui binding resolution", () => {
  test("getPath resolves nested pointers and array indices", () => {
    const data = { a: { b: [{ c: 42 }] } };
    assert.equal(getPath(data, "/a/b/0/c"), 42);
    assert.equal(getPath(data, "a/b/0/c"), 42);
    assert.equal(getPath(data, "/a/missing"), undefined);
    assert.equal(getPath(undefined, "/a"), undefined);
  });

  test("resolveBinding passes literals through and follows paths", () => {
    assert.equal(resolveBinding("text", { x: 1 }), "text");
    assert.equal(resolveBinding(7, undefined), 7);
    assert.equal(resolveBinding({ path: "/x" }, { x: 1 }), 1);
  });

  test("formatValue renders scalars and dashes the rest", () => {
    assert.equal(formatValue("bp"), "bp");
    assert.equal(formatValue(120), "120");
    assert.equal(formatValue(undefined), "—");
    assert.equal(formatValue({}), "—");
  });
});

describe("generateUI tool", () => {
  const priorMessages: ModelMessage[] = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "searchPatients",
          input: {},
        },
        {
          type: "tool-call",
          toolCallId: "call_2",
          toolName: "getEncounters",
          input: {},
        },
      ],
    },
  ];

  // `execute`'s options type has an uninferrable Context generic when called
  // outside a streamText run, so pin the signature once here.
  const makeRunner = (seenToolCalls: ReadonlyMap<string, string>) =>
    generateUI({ seenToolCalls }).execute as (
      input: A2UISpec,
      options: { toolCallId: string; messages: ModelMessage[] }
    ) => Promise<{ ok: true } | { error: string }>;
  const runGenerateUI = makeRunner(new Map());

  test("accepts a spec whose sources match prior tool calls", async () => {
    const result = await runGenerateUI(validSpec, {
      toolCallId: "call_ui",
      messages: priorMessages,
    });
    assert.deepEqual(result, { ok: true });
  });

  test("accepts same-step sources via the live registry", async () => {
    // A call made in the same step is absent from `messages` but present in
    // the route's onChunk-fed registry.
    const run = makeRunner(new Map([["call_1", "searchPatients"]]));
    const result = await run(validSpec, {
      toolCallId: "call_ui",
      messages: [],
    });
    assert.deepEqual(result, { ok: true });
  });

  test("rejects an unknown sourceToolCallId", async () => {
    const spec: A2UISpec = {
      root: "patients",
      components: [
        {
          id: "patients",
          component: "PatientsCard",
          sourceToolCallId: "call_hallucinated",
        },
      ],
    };
    const result = await runGenerateUI(spec, {
      toolCallId: "call_ui",
      messages: priorMessages,
    });
    assert.ok("error" in result);
    assert.match(result.error, /call_hallucinated/);
  });

  test("rejects a domain card bound to the wrong tool", async () => {
    const spec: A2UISpec = {
      root: "patients",
      components: [
        {
          id: "patients",
          component: "PatientsCard",
          // call_2 is a getEncounters call — not a valid PatientsCard source.
          sourceToolCallId: "call_2",
        },
      ],
    };
    const result = await runGenerateUI(spec, {
      toolCallId: "call_ui",
      messages: priorMessages,
    });
    assert.ok("error" in result);
    assert.match(result.error, /cannot render output/);
  });
});
