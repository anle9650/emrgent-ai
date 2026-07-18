import { generateText, isStepCount } from "ai";
import { format } from "date-fns";
import { chatModels } from "@/lib/ai/models";
import { systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  buildScribeKickoffMessage,
  type ScribePatientRef,
} from "@/lib/ai/scribe";
import { generateUI } from "@/lib/ai/tools/generate-ui";
import {
  createEncounter,
  createMedicalProblem,
  createMedication,
  createSurgery,
  getAppointments,
  getAvailableAppointments,
  getEncounters,
  getMedicalProblems,
  getMedications,
  getSoapNote,
  getSurgeries,
  searchPatients,
  updateMedicalProblem,
  updateMedication,
} from "@/lib/ai/tools/openemr";
// Server-only module, inert here: vitest.config.ts aliases `server-only` to
// an empty stub, and the fixture branch returns before the lazy auth import
// is reached.
import { fetchPatientOverview } from "@/lib/openemr/patient-overview";

export const SCRIBE_EVAL_MODEL = "moonshotai/kimi-k2.5";

export type ScribeToolCall = {
  step: number;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type ScribeToolResult = {
  toolCallId: string;
  toolName: string;
  output: unknown;
};

export type ScribeRun = {
  kickoff: string;
  visitDate: string;
  toolCalls: ScribeToolCall[];
  toolResults: ScribeToolResult[];
  text: string;
};

/**
 * Run one live scribe session: build the kickoff message the recorder would
 * send and drive the production agent configuration (same system prompt,
 * step budget, provider routing, and OpenEMR tools as
 * app/(chat)/api/chat/route.ts) against a live gateway model. Differences
 * from production, both deliberate: no `toolApproval` (writes auto-execute
 * against fixtures — there is no UI to approve them), and the artifact/
 * weather tools are omitted (they need a dataStream + session and play no
 * part in the scribe protocol).
 */
export async function runScribeSession({
  patient,
  transcript,
  omitPriorChart,
}: {
  patient: ScribePatientRef;
  transcript: string;
  omitPriorChart?: boolean;
}): Promise<ScribeRun> {
  const visitDate = format(new Date(), "yyyy-MM-dd");
  // Mirrors the client prefetch in scribe-flow.tsx: the kickoff carries the
  // prior chart unless the case exercises the fallback path. Runs inside the
  // eval task's private withFixtureState scope, so it sees a pristine chart.
  const priorChart = omitPriorChart
    ? null
    : await fetchPatientOverview(patient.uuid, String(patient.pid));
  const kickoff = buildScribeKickoffMessage({
    patient,
    transcript,
    visitDate,
    visitTime: format(new Date(), "HH:mm"),
    priorChart,
  });

  const modelConfig = chatModels.find((m) => m.id === SCRIBE_EVAL_MODEL);
  const seenToolCalls = new Map<string, string>();

  const result = await generateText({
    model: getLanguageModel(SCRIBE_EVAL_MODEL),
    instructions: systemPrompt({
      requestHints: {
        latitude: undefined,
        longitude: undefined,
        city: undefined,
        country: undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      supportsTools: true,
      openEmrConnected: true,
    }),
    messages: [{ role: "user", content: kickoff }],
    stopWhen: isStepCount(16),
    ...(modelConfig?.gatewayOrder && {
      providerOptions: { gateway: { order: modelConfig.gatewayOrder } },
    }),
    tools: {
      searchPatients,
      getEncounters,
      getSoapNote,
      getAppointments,
      getAvailableAppointments,
      getMedicalProblems,
      getMedications,
      getSurgeries,
      createEncounter,
      createMedicalProblem,
      updateMedicalProblem,
      createMedication,
      updateMedication,
      createSurgery,
      generateUI: generateUI({ seenToolCalls }),
    },
    // The registry generateUI validates sourceToolCallId refs against; the
    // chat route fills it from streaming chunks, here execution starts serve
    // the same purpose.
    onToolExecutionStart: ({ toolCall }) => {
      seenToolCalls.set(toolCall.toolCallId, toolCall.toolName);
    },
  });

  const toolCalls: ScribeToolCall[] = result.steps.flatMap((step, stepIndex) =>
    step.toolCalls.map((call) => ({
      step: stepIndex,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: (call.input ?? {}) as Record<string, unknown>,
    }))
  );

  const toolResults: ScribeToolResult[] = result.steps.flatMap((step) =>
    step.toolResults.map((toolResult) => ({
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      output: toolResult.output,
    }))
  );

  return { kickoff, visitDate, toolCalls, toolResults, text: result.text };
}
