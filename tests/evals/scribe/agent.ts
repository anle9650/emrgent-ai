import { generateText, isStepCount, tool } from "ai";
import { format } from "date-fns";
import { z } from "zod";
import { chatModels } from "@/lib/ai/models";
import { systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  buildScribeKickoffMessage,
  type ScribePatientRef,
} from "@/lib/ai/scribe";
import { generateUI } from "@/lib/ai/tools/generate-ui";
import {
  createAppointment,
  createEncounter,
  createMedicalProblem,
  createMedication,
  createSurgery,
  getAppointments,
  getEncounters,
  getMedicalProblems,
  getMedications,
  getNextAppointment,
  getSoapNote,
  getSurgeries,
  searchPatients,
  sendMessage,
  sendReferral,
  updateMedicalProblem,
  updateMedication,
} from "@/lib/ai/tools/openemr";
import { selectAppointmentSlot } from "@/lib/ai/tools/select-appointment-slot";
// Server-only modules, inert here: vitest.config.ts aliases `server-only` to
// an empty stub, and the fixture branch returns before the lazy auth import
// is reached.
import { fetchAvailableAppointments } from "@/lib/openemr/available-appointments";
import { fetchPatientOverview } from "@/lib/openemr/patient-overview";

// In production selectAppointmentSlot has NO execute — the browser picker
// supplies its result and the run pauses. The eval runs server-side with no
// browser, so a no-execute tool would hang the run forever. This harness copy
// simulates the clinician: it fetches candidates from the fixture calendar
// (the same helper the client picker's proxy uses) and picks the first open
// slot, or skips when none are open. The production tool stays untouched, so
// the client resume plumbing is covered only by the e2e scribe test.
const selectAppointmentSlotStub = tool({
  description: selectAppointmentSlot.description,
  inputSchema: selectAppointmentSlot.inputSchema,
  outputSchema: selectAppointmentSlot.outputSchema,
  execute: async (input) => {
    const candidates = await fetchAvailableAppointments({
      duration: input.duration,
      title: input.title,
      startDate: input.startDate,
      endDate: input.endDate,
      startTime: input.startTime,
      endTime: input.endTime,
      daysOfWeek: input.daysOfWeek,
    });
    const chosenSlot = candidates.at(0);
    return chosenSlot ? { chosenSlot } : { skipped: true as const };
  },
});

// In production `search_individual_providers` is an MCP tool from Merge Agent
// Handler (the NPI Registry), absent here — the eval sets no MERGE_* env, so
// `createMergeMcpTools` returns null. Stub it so referral cases can exercise
// the full look-up-then-refer flow. Each search returns one provider whose NPI
// is derived deterministically from the search terms, so distinct searches
// (e.g. dermatology vs orthopedics) yield distinct NPIs and the checks can
// confirm each referral copied a looked-up NPI rather than inventing one.
export const PROVIDER_SEARCH_TOOL_NAME = "search_individual_providers";

const searchIndividualProvidersStub = tool({
  description:
    "Search for individual healthcare providers (NPI-1) like doctors and nurses by name, specialty, or location. Supports wildcards (*) in names.",
  inputSchema: z.object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    taxonomy_description: z
      .string()
      .optional()
      .describe("Specialty/taxonomy, e.g. 'Dermatology'."),
    state: z.string().optional(),
    city: z.string().optional(),
    postal_code: z.string().optional(),
  }),
  execute: (input) => {
    const seed = [
      input.taxonomy_description,
      input.last_name,
      input.first_name,
      input.state,
    ]
      .filter(Boolean)
      .join("|")
      .toLowerCase();
    // FNV-1a → a stable, well-distributed 10-digit NPI per distinct search.
    let hash = 2_166_136_261;
    for (const ch of seed) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    const npi = String(1_000_000_000 + (hash % 9_000_000_000));
    return Promise.resolve({
      results: [
        {
          npi,
          firstName: input.first_name?.replace(/\*/g, "") || "Alex",
          lastName: input.last_name?.replace(/\*/g, "") || "Rivera",
          taxonomy: input.taxonomy_description ?? "Physician",
          state: input.state ?? "CA",
        },
      ],
    });
  },
});

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
        state: undefined,
        postalCode: undefined,
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
      selectAppointmentSlot: selectAppointmentSlotStub,
      createAppointment,
      getMedicalProblems,
      getMedications,
      getSurgeries,
      createEncounter,
      createMedicalProblem,
      updateMedicalProblem,
      createMedication,
      updateMedication,
      createSurgery,
      sendMessage,
      sendReferral,
      [PROVIDER_SEARCH_TOOL_NAME]: searchIndividualProvidersStub,
      getNextAppointment,
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
