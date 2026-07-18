import type {
  LanguageModelV3FinishReason,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { A2UISpec } from "@/lib/ai/a2ui/schema";

// Scripted mock models for the Playwright environment (wired up in
// providers.ts). Trigger phrases in the last user message play a fixed
// multi-step script — data tool call, then a generateUI call bound to the
// data tool's result, then closing text — so tool chrome, domain cards, and
// artifact click-through are all e2e-testable. Anything else streams fixed
// text. The mock is stateless: each doStream re-derives its position in the
// script from the tool-result messages after the last user message.

const usage: LanguageModelV3Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const STOP: LanguageModelV3FinishReason = { unified: "stop", raw: "stop" };
const TOOL_CALLS: LanguageModelV3FinishReason = {
  unified: "tool-calls",
  raw: "tool_calls",
};

function textStep(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "text-start", id: "text-1" },
    ...text.split(" ").map(
      (word): LanguageModelV3StreamPart => ({
        type: "text-delta",
        id: "text-1",
        delta: `${word} `,
      })
    ),
    { type: "text-end", id: "text-1" },
    { type: "finish", finishReason: STOP, usage },
  ];
}

// The stream parts of a single tool call, without the step-ending finish —
// so a response can carry several calls (parallel approvals) before one
// `tool-calls` finish.
function toolCallParts(
  toolCallId: string,
  toolName: string,
  input: unknown
): LanguageModelV3StreamPart[] {
  const json = JSON.stringify(input);
  return [
    { type: "tool-input-start", id: toolCallId, toolName },
    { type: "tool-input-delta", id: toolCallId, delta: json },
    { type: "tool-input-end", id: toolCallId },
    { type: "tool-call", toolCallId, toolName, input: json },
  ];
}

// `tool-calls` finish is what makes streamText execute the tool and re-invoke
// doStream for the next step (bounded by the chat route's stopWhen).
function toolCallStep(
  toolCallId: string,
  toolName: string,
  input: unknown
): LanguageModelV3StreamPart[] {
  return [
    ...toolCallParts(toolCallId, toolName, input),
    { type: "finish", finishReason: TOOL_CALLS, usage },
  ];
}

// Trigger matching uses the last user message ONLY — the system prompt
// mentions "patient"/"appointment" and would false-trigger on the full prompt.
function lastUserMessageText(prompt: LanguageModelV3Prompt): string {
  const lastUser = prompt.findLast((message) => message.role === "user");
  if (!lastUser || typeof lastUser.content === "string") {
    return "";
  }
  return lastUser.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ");
}

// Tool results after the last user message locate us within the current run's
// script; a follow-up user turn naturally resets the script.
function toolResultsAfterLastUser(
  prompt: LanguageModelV3Prompt
): LanguageModelV3ToolResultPart[] {
  const lastUserIndex = prompt.findLastIndex(
    (message) => message.role === "user"
  );
  return prompt
    .slice(lastUserIndex + 1)
    .filter((message) => message.role === "tool")
    .flatMap((message) =>
      message.content.filter((part) => part.type === "tool-result")
    );
}

// Local date, not toISOString() (UTC) — matching how the fixtures date their
// calendar rows, so a window computed here lines up with the slots they serve.
function localDateDaysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// The data tools stamp their own toolCallId into the result as
// `sourceToolCallId` — copy it exactly as a real model would. Fall back to the
// part's toolCallId (identical by construction) if the output isn't JSON.
function sourceIdFrom(result: LanguageModelV3ToolResultPart): string {
  const output = result.output;
  if (
    output.type === "json" &&
    output.value &&
    typeof output.value === "object" &&
    "sourceToolCallId" in output.value &&
    typeof output.value.sourceToolCallId === "string"
  ) {
    return output.value.sourceToolCallId;
  }
  return result.toolCallId;
}

type Scenario = {
  trigger: RegExp;
  dataToolName:
    | "getAppointments"
    | "getAvailableAppointments"
    | "searchPatients";
  dataToolInput: Record<string, unknown>;
  buildUiSpec: (sourceToolCallId: string) => A2UISpec;
  closingText: string;
};

// Order matters: "appointment" prompts usually also contain "patient"-ish
// words, so the more specific trigger comes first — and "schedule" is more
// specific still, since scheduling prompts also say "appointment".
const SCENARIOS: Scenario[] = [
  {
    trigger: /schedule|available/i,
    dataToolName: "getAvailableAppointments",
    // pid 1 is Eleanor Vance in the fixtures — the picker needs it to book.
    dataToolInput: { duration: 900, pid: 1 },
    buildUiSpec: (sourceToolCallId) => ({
      root: "picker",
      components: [
        { id: "picker", component: "AppointmentPickerCard", sourceToolCallId },
      ],
    }),
    closingText: "Pick a time that works and I'll book it.",
  },
  {
    trigger: /appointment/i,
    dataToolName: "getAppointments",
    dataToolInput: {},
    buildUiSpec: (sourceToolCallId) => ({
      root: "appts",
      components: [
        { id: "appts", component: "AppointmentsCard", sourceToolCallId },
      ],
    }),
    closingText: "Here are the upcoming appointments from the calendar.",
  },
  {
    trigger: /patient/i,
    dataToolName: "searchPatients",
    dataToolInput: {},
    buildUiSpec: (sourceToolCallId) => ({
      root: "patients",
      components: [
        { id: "patients", component: "PatientsCard", sourceToolCallId },
      ],
    }),
    closingText: "I found these patients in OpenEMR.",
  },
];

// Matches the kickoff header built by buildScribeKickoffMessage
// (lib/ai/scribe.ts) — the mock copies the patient ref out of the message,
// as a real model would. Checked before SCENARIOS because the kickoff text
// also contains "patient".
const SCRIBE_TRIGGER =
  /Scribe session for patient (.+) \(uuid: ([0-9a-f-]+), pid: (\d+)\)/i;

// The first problem from the kickoff's prior-chart block, with the fields
// `problemRefSchema` wants copied verbatim — as a real model would. Parses
// the single-line JSON on the line after the "#### Medical problems" header,
// the exact format buildScribePriorChart (lib/ai/scribe.ts) writes; the
// coupling is locked by tests/unit/mock-scenarios.test.ts. An "Unavailable"
// section or absent block yields null.
function firstProblemFromPriorChart(userText: string) {
  const jsonLine = userText.match(/^#### Medical problems\n(\[.*)$/m)?.[1];
  if (!jsonLine) {
    return null;
  }
  try {
    const problems = JSON.parse(jsonLine) as Record<string, unknown>[];
    const problem = problems.at(0);
    if (!problem) {
      return null;
    }
    return {
      uuid: problem.uuid,
      title: problem.title,
      begdate: problem.begdate ?? null,
      enddate: problem.enddate ?? null,
      diagnosis: problem.diagnosis ?? [],
    };
  } catch {
    return null;
  }
}

// 4-step scribe script driven by the kickoff's prior-chart block:
// (1) updateMedicalProblem (when the block lists a problem) + createEncounter
// TOGETHER in one step (both pause for user approval — this exercises the
// multi-approval flow; the continuation replays with both results appended),
// (2) getAvailableAppointments, because the canned transcript closes by asking
// for a six-month recheck (scribePrompt step 6), (3) generateUI with the
// closing surface from step 7 — a Column of the ViewChartCard, a heading, and
// the AppointmentPickerCard — which is the only place the catalog's layout
// primitives wrap more than one domain card, (4) closing text. No block or an
// empty problem list degrades step 1 to createEncounter only.
function scribeChunks(
  prompt: LanguageModelV3Prompt,
  patient: { uuid: string; pid: number; name: string },
  userText: string
): LanguageModelV3StreamPart[] {
  const results = toolResultsAfterLastUser(prompt);
  if (results.some((result) => result.toolName === "generateUI")) {
    return textStep(
      "Charted the encounter with vitals and a SOAP note in OpenEMR."
    );
  }
  const encounterResult = results.find(
    (result) => result.toolName === "createEncounter"
  );
  const slotsResult = results.find(
    (result) => result.toolName === "getAvailableAppointments"
  );
  if (encounterResult && slotsResult) {
    return toolCallStep(`mock-scribe-ui-${prompt.length}`, "generateUI", {
      root: "col",
      components: [
        {
          id: "col",
          component: "Column",
          children: ["view", "heading", "picker"],
        },
        {
          id: "view",
          component: "ViewChartCard",
          sourceToolCallId: sourceIdFrom(encounterResult),
        },
        {
          id: "heading",
          component: "Text",
          variant: "heading",
          text: "Schedule follow-up",
        },
        {
          id: "picker",
          component: "AppointmentPickerCard",
          sourceToolCallId: sourceIdFrom(slotsResult),
        },
      ],
    });
  }
  if (encounterResult) {
    // A week-long window about six months out, because that's the recheck the
    // canned transcript asks for — a real model derives the window from the
    // transcript's timeframe rather than searching from today (scribePrompt
    // step 6).
    const start = localDateDaysFromNow(180);
    const end = localDateDaysFromNow(187);
    return toolCallStep(
      `mock-scribe-slots-${prompt.length}`,
      "getAvailableAppointments",
      {
        pid: patient.pid,
        duration: 900,
        title: "Blood pressure recheck",
        startDate: start,
        endDate: end,
      }
    );
  }
  const problem = firstProblemFromPriorChart(userText);
  return [
    ...(problem
      ? toolCallParts(
          `mock-scribe-problem-${prompt.length}`,
          "updateMedicalProblem",
          // `enddate: null` re-affirms the problem as active — a harmless
          // change field that satisfies the tool's at-least-one refinement.
          { patient, problem, enddate: null }
        )
      : []),
    ...toolCallParts(
      `mock-scribe-encounter-${prompt.length}`,
      "createEncounter",
      {
        patient,
        reason: "Hypertension follow-up",
        vitals: { bps: 132, bpd: 84, pulse: 76 },
        soapNote: {
          subjective: "Headaches improved since starting lisinopril.",
          objective: "BP 132/84, pulse 76.",
          assessment:
            "Hypertension, improving. New seasonal allergic rhinitis.",
          plan: "Continue lisinopril 10 mg daily; start loratadine 10 mg PRN.",
        },
      }
    ),
    { type: "finish", finishReason: TOOL_CALLS, usage },
  ];
}

export function chunksForPrompt(
  prompt: LanguageModelV3Prompt
): LanguageModelV3StreamPart[] {
  const userText = lastUserMessageText(prompt);

  const scribeMatch = SCRIBE_TRIGGER.exec(userText);
  if (scribeMatch) {
    return scribeChunks(
      prompt,
      {
        name: scribeMatch[1],
        uuid: scribeMatch[2],
        pid: Number(scribeMatch[3]),
      },
      userText
    );
  }

  const scenario = SCENARIOS.find((s) => s.trigger.test(userText));

  if (scenario) {
    const results = toolResultsAfterLastUser(prompt);
    if (results.some((result) => result.toolName === "generateUI")) {
      return textStep(scenario.closingText);
    }
    const dataResult = results.find(
      (result) => result.toolName === scenario.dataToolName
    );
    // The `-${prompt.length}` suffix keeps ids unique when the same scenario
    // runs again in a later turn (persisted parts keep their old ids, and
    // A2UI source resolution indexes across all messages).
    if (dataResult) {
      return toolCallStep(
        `mock-ui-${scenario.dataToolName}-${prompt.length}`,
        "generateUI",
        scenario.buildUiSpec(sourceIdFrom(dataResult))
      );
    }
    return toolCallStep(
      `mock-call-${scenario.dataToolName}-${prompt.length}`,
      scenario.dataToolName,
      scenario.dataToolInput
    );
  }

  if (/weather|temperature/i.test(userText)) {
    return textStep("The weather in San Francisco is sunny and 72°F.");
  }
  if (/\b(hello|hi|hey)\b/i.test(userText)) {
    return textStep("Hello! How can I help you today?");
  }
  return textStep("This is a mock response for testing.");
}

export const chatModel = new MockLanguageModelV3({
  modelId: "mock-chat-model",
  doGenerate: {
    content: [{ type: "text", text: "This is a mock response for testing." }],
    finishReason: STOP,
    usage,
    warnings: [],
  },
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 10,
      chunks: chunksForPrompt(prompt),
    }),
  }),
});

export const titleModel = new MockLanguageModelV3({
  modelId: "mock-title-model",
  doGenerate: {
    content: [{ type: "text", text: "Test Conversation" }],
    finishReason: STOP,
    usage,
    warnings: [],
  },
  // A function (not a static result): a ReadableStream is single-use, and the
  // title model streams once per new chat.
  doStream: async () => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 10,
      chunks: textStep("Test Conversation"),
    }),
  }),
});
