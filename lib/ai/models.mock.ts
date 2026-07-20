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

// A reasoning block ahead of the visible text — this is what makes the client
// render the "Thought for a few seconds" collapsible (components/ai-elements/
// reasoning.tsx: ReasoningTrigger falls back to that copy once streaming ends
// and no explicit duration was set, which the mock never sends).
function reasoningParts(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "reasoning-start", id: "reasoning-1" },
    ...text.split(" ").map(
      (word): LanguageModelV3StreamPart => ({
        type: "reasoning-delta",
        id: "reasoning-1",
        delta: `${word} `,
      })
    ),
    { type: "reasoning-end", id: "reasoning-1" },
  ];
}

// `reasoning` is opt-in per call site — most scripted steps are narrated tool
// calls where a "thinking" preamble would just repeat on every turn; it's
// wired up for the plain-text fallback replies (see chunksForPrompt) where a
// single reasoning block reads naturally.
function textStep(text: string, reasoning?: string): LanguageModelV3StreamPart[] {
  return [
    ...(reasoning ? reasoningParts(reasoning) : []),
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

// A step that narrates the upcoming call before making it — mirrors
// scribePrompt's instruction to speak to the user just before a tool call
// (e.g. step 3's "brief line" before selectAppointmentSlot), so the mock's
// transcript reads like a real run instead of a bare sequence of tool chips.
function textThenToolCallStep(
  text: string,
  toolCallId: string,
  toolName: string,
  input: unknown
): LanguageModelV3StreamPart[] {
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

// The slot the user picked in the (client-resolved) selectAppointmentSlot
// call, read back from its result so the mock can book it with
// createAppointment — as a real model copies `chosenSlot` verbatim. Null when
// the user skipped scheduling (`{ skipped: true }`).
function chosenSlotFrom(
  result: LanguageModelV3ToolResultPart
): Record<string, unknown> | null {
  const output = result.output;
  if (
    output.type === "json" &&
    output.value &&
    typeof output.value === "object" &&
    "chosenSlot" in output.value &&
    output.value.chosenSlot &&
    typeof output.value.chosenSlot === "object"
  ) {
    return output.value.chosenSlot as Record<string, unknown>;
  }
  return null;
}

// Eleanor Vance in the fixtures (uuid literal mirrors ELEANOR_UUID in
// lib/openemr/fixtures.ts) — scheduling tools need a patient ref.
const ELEANOR = {
  uuid: "11111111-1111-4111-8111-111111111111",
  pid: 1,
  name: "Eleanor Vance",
};

type Scenario = {
  trigger: RegExp;
  dataToolName: "getAppointments" | "searchPatients";
  dataToolInput: Record<string, unknown>;
  buildUiSpec: (sourceToolCallId: string) => A2UISpec;
  closingText: string;
};

// Order matters: "appointment" prompts usually also contain "patient"-ish
// words, so the more specific trigger comes first. (Scheduling — "schedule"/
// "available" — is routed ahead of SCENARIOS in chunksForPrompt, since it's an
// interactive client-tool flow that pauses the run, not a data→UI→text one.)
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

// Scribe script driven by the kickoff's prior-chart block, scheduling before
// charting — the follow-up picker renders (and PAUSES the run) while the
// patient is still in the room, so they can pick a slot before the writes
// stall behind the clinician's approvals (scribePrompt step 3):
// (1) selectAppointmentSlot, because the canned transcript closes by asking
// for a six-month recheck — a no-execute client tool, so the run pauses until
// the picker resolves it (the e2e test drives the pick); (2) createAppointment
// with the chosen slot copied verbatim, once the pick resolves (skipped when
// the user skipped); (3) the chart writes as THREE staged approval waves,
// each its own step so its approval card pauses the run before the next wave
// is sent (scribePrompt steps 4–6): updateMedicalProblem (when the block
// lists a problem) → createMedication (the transcript's loratadine) →
// createEncounter alone; (4) sendMessage — the plain-language visit-summary
// portal message, its own approval-gated step (scribePrompt step 7); (5)
// generateUI with the ViewChartCard (step 8); (6) getNextAppointment — a read
// tool (no approval) that surfaces the next roomed patient's start-scribe card
// (step 9); (7) closing text (step 10). No block or an empty problem list skips
// the update wave. The picker and each write's step opens with a short
// narrating line via textThenToolCallStep — mirroring scribePrompt's
// instruction to speak to the user just before a call — so a captured
// transcript reads like a real run's commentary, not a bare tool-chip list.
function scribeChunks(
  prompt: LanguageModelV3Prompt,
  patient: { uuid: string; pid: number; name: string },
  userText: string
): LanguageModelV3StreamPart[] {
  const results = toolResultsAfterLastUser(prompt);
  const uiResults = results.filter(
    (result) => result.toolName === "generateUI"
  );
  const encounterResult = results.find(
    (result) => result.toolName === "createEncounter"
  );
  const selectResult = results.find(
    (result) => result.toolName === "selectAppointmentSlot"
  );
  const bookingResult = results.find(
    (result) => result.toolName === "createAppointment"
  );
  const sendMessageResult = results.find(
    (result) => result.toolName === "sendMessage"
  );
  const nextAppointmentResult = results.find(
    (result) => result.toolName === "getNextAppointment"
  );
  if (encounterResult && uiResults.length >= 1 && nextAppointmentResult) {
    return textStep(
      "Done. I've updated the patient's medical history, charted the encounter, and sent a visit summary to the patient. Ready to see your next patient?"
    );
  }
  if (encounterResult && uiResults.length >= 1) {
    // The ViewChartCard is up — now surface the next roomed patient as a
    // one-click prompt (scribePrompt step 9). getNextAppointment is a read
    // tool: it just runs against the fixtures (returning the other roomed
    // patient, Marcus Webb) and renders its own card — no approval, no
    // generateUI.
    return toolCallStep(
      `mock-scribe-next-${prompt.length}`,
      "getNextAppointment",
      { patient }
    );
  }
  if (encounterResult && sendMessageResult) {
    return toolCallStep(`mock-scribe-ui-${prompt.length}`, "generateUI", {
      root: "view",
      components: [
        {
          id: "view",
          component: "ViewChartCard",
          sourceToolCallId: sourceIdFrom(encounterResult),
        },
      ],
    });
  }
  if (encounterResult) {
    // Encounter filed → send the patient a plain-language visit-summary portal
    // message (scribePrompt step 7). Approval-gated, so it pauses the run like
    // the chart writes before it.
    return textThenToolCallStep(
      "Sending the visit summary message to the patient.",
      `mock-scribe-message-${prompt.length}`,
      "sendMessage",
      {
        patient,
        title: "Your Hypertension Visit Summary",
        body: "We checked your blood pressure today and it's improving on lisinopril — keep taking it once daily. For the seasonal congestion, start loratadine as needed. We'll recheck your blood pressure in six months; that follow-up is already on the calendar.",
      }
    );
  }
  if (!selectResult) {
    // A week-long window about six months out, because that's the recheck the
    // canned transcript asks for — a real model derives the window from the
    // transcript's timeframe rather than searching from today (scribePrompt
    // step 3). The picker self-fetches slots and pauses the run here.
    const start = localDateDaysFromNow(180);
    const end = localDateDaysFromNow(187);
    // The patient's first name, matching the "brief line" scribePrompt step 3
    // asks for just before the picker: acknowledge the transcript, then tell
    // the clinician to book, naming the patient and the purpose.
    const firstName = patient.name.split(" ")[0];
    return textThenToolCallStep(
      `I've reviewed the encounter transcript. First, book a 6-month blood pressure recheck for ${firstName}.`,
      `mock-scribe-select-${prompt.length}`,
      "selectAppointmentSlot",
      {
        patient,
        duration: 900,
        title: "Blood pressure recheck",
        startDate: start,
        endDate: end,
      }
    );
  }
  const chosenSlot = chosenSlotFrom(selectResult);
  if (chosenSlot && !bookingResult) {
    return toolCallStep(
      `mock-scribe-book-${prompt.length}`,
      "createAppointment",
      { patient, slot: chosenSlot }
    );
  }
  // The staged write waves: updates → creates → encounter, one approval-gated
  // step each, re-derived from which write results the continuation carries.
  const problem = firstProblemFromPriorChart(userText);
  const updateResult = results.find(
    (result) => result.toolName === "updateMedicalProblem"
  );
  if (problem && !updateResult) {
    return textThenToolCallStep(
      "Updating her existing medical problem.",
      `mock-scribe-problem-${prompt.length}`,
      "updateMedicalProblem",
      // `enddate: null` re-affirms the problem as active — a harmless
      // change field that satisfies the tool's at-least-one refinement.
      { patient, problem, enddate: null }
    );
  }
  const medicationResult = results.find(
    (result) => result.toolName === "createMedication"
  );
  if (!medicationResult) {
    return textThenToolCallStep(
      "Adding Loratadine 10mg to her list of medications.",
      `mock-scribe-medication-${prompt.length}`,
      "createMedication",
      { patient, title: "Loratadine 10mg" },
    );
  }
  return textThenToolCallStep(
    "Documenting her vitals and encounter notes.",
    `mock-scribe-encounter-${prompt.length}`,
    "createEncounter",
    {
      patient,
      reason: "Hypertension follow-up",
      vitals: { bps: 132, bpd: 84, pulse: 76 },
      soapNote: {
        subjective: "Headaches improved since starting lisinopril.",
        objective: "BP 132/84, pulse 76.",
        assessment: "Hypertension, improving. New seasonal allergic rhinitis.",
        plan: "Continue lisinopril 10 mg daily; start loratadine 10 mg PRN.",
      },
    }
  );
}

// Interactive scheduling for general chat: selectAppointmentSlot (no-execute
// client tool — the picker self-fetches slots and PAUSES the run until the
// user picks/skips) → createAppointment with the chosen slot → closing text.
// No date window, so the picker's proxy defaults to today..+6 days — the
// fixtures' open weekdays are in range (mirrors the e2e assertions).
function scheduleChunks(
  prompt: LanguageModelV3Prompt
): LanguageModelV3StreamPart[] {
  const results = toolResultsAfterLastUser(prompt);
  const selectResult = results.find(
    (result) => result.toolName === "selectAppointmentSlot"
  );
  const bookingResult = results.find(
    (result) => result.toolName === "createAppointment"
  );
  if (!selectResult) {
    return toolCallStep(
      `mock-select-${prompt.length}`,
      "selectAppointmentSlot",
      { patient: ELEANOR, duration: 900, title: "Follow-up" }
    );
  }
  const chosenSlot = chosenSlotFrom(selectResult);
  if (chosenSlot && !bookingResult) {
    return toolCallStep(`mock-book-${prompt.length}`, "createAppointment", {
      patient: ELEANOR,
      slot: chosenSlot,
    });
  }
  return textStep(
    chosenSlot
      ? "Booked it — the appointment is on the calendar."
      : "No problem — you can schedule a follow-up anytime."
  );
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

  // Ahead of SCENARIOS: scheduling is an interactive pause-the-run flow, not
  // the data→UI→text shape SCENARIOS models.
  if (/schedule|available/i.test(userText)) {
    return scheduleChunks(prompt);
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
    return textStep(
      "The weather in San Francisco is sunny and 72°F.",
      "The user is asking about the weather, so I should check San Francisco's current conditions."
    );
  }
  if (/\b(hello|hi|hey)\b/i.test(userText)) {
    return textStep(
      "Hello! How can I help you today?",
      "The user is just greeting me — a friendly, brief reply is all that's needed here."
    );
  }
  return textStep(
    "This is a mock response for testing.",
    "This prompt doesn't match any scripted scenario, so a generic placeholder reply is appropriate."
  );
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
