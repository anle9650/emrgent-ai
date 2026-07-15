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

// `tool-calls` finish is what makes streamText execute the tool and re-invoke
// doStream for the next step (bounded by the chat route's stopWhen).
function toolCallStep(
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
  dataToolName: "getAppointments" | "searchPatients";
  dataToolInput: Record<string, unknown>;
  buildUiSpec: (sourceToolCallId: string) => A2UISpec;
  closingText: string;
};

// Order matters: "appointment" prompts usually also contain "patient"-ish
// words, so the more specific trigger comes first.
const SCENARIOS: Scenario[] = [
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

// 3-step scribe script: getMedicalProblems -> createEncounter (pauses for
// user approval; the approval continuation replays with the tool result
// appended) -> closing text.
function scribeChunks(
  prompt: LanguageModelV3Prompt,
  patient: { uuid: string; pid: number; name: string }
): LanguageModelV3StreamPart[] {
  const results = toolResultsAfterLastUser(prompt);
  if (results.some((result) => result.toolName === "createEncounter")) {
    return textStep(
      "Charted the encounter with vitals and a SOAP note in OpenEMR."
    );
  }
  if (results.some((result) => result.toolName === "getMedicalProblems")) {
    return toolCallStep(
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
    );
  }
  return toolCallStep(
    `mock-scribe-problems-${prompt.length}`,
    "getMedicalProblems",
    {
      patient,
    }
  );
}

export function chunksForPrompt(
  prompt: LanguageModelV3Prompt
): LanguageModelV3StreamPart[] {
  const userText = lastUserMessageText(prompt);

  const scribeMatch = SCRIBE_TRIGGER.exec(userText);
  if (scribeMatch) {
    return scribeChunks(prompt, {
      name: scribeMatch[1],
      uuid: scribeMatch[2],
      pid: Number(scribeMatch[3]),
    });
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
