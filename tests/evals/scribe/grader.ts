import { generateText, tool } from "ai";
import { z } from "zod";
import { chatModels } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { SCRIBE_EVAL_MODEL, type ScribeRun } from "./agent";
import type { ScribeEvalCase } from "./cases";

const gradeSchema = z.object({
  accuracy: z
    .number()
    .min(1)
    .max(5)
    .describe("Does the documentation reflect what actually happened? 1-5."),
  completeness: z
    .number()
    .min(1)
    .max(5)
    .describe("Is everything clinically relevant captured? 1-5."),
  noHallucination: z
    .number()
    .min(1)
    .max(5)
    .describe(
      "5 = nothing documented that the transcript does not support; 1 = fabricated findings."
    ),
  rationale: z
    .string()
    .describe("2-4 sentences citing the specific evidence behind the scores."),
  pass: z
    .boolean()
    .describe(
      "false if a clinician reviewing this chart entry would need to correct it."
    ),
});

export type Grade = z.infer<typeof gradeSchema>;

// Forced tool call rather than structured output: Kimi K2.5's tool calling
// through the gateway is exercised by the whole app, while its JSON-schema
// response_format support is unproven.
async function runGrader(
  instructions: string,
  content: string
): Promise<Grade> {
  const modelConfig = chatModels.find((m) => m.id === SCRIBE_EVAL_MODEL);
  const attempt = async () => {
    const result = await generateText({
      model: getLanguageModel(SCRIBE_EVAL_MODEL),
      instructions,
      messages: [{ role: "user", content }],
      tools: {
        submitGrade: tool({
          description: "Submit the final grade for this chart entry.",
          inputSchema: gradeSchema,
          execute: (grade) => Promise.resolve(grade),
        }),
      },
      toolChoice: { type: "tool", toolName: "submitGrade" },
      ...(modelConfig?.gatewayOrder && {
        providerOptions: { gateway: { order: modelConfig.gatewayOrder } },
      }),
    });
    const call = result.toolCalls.at(0);
    if (!call) {
      throw new Error("grader made no submitGrade call");
    }
    return gradeSchema.parse(call.input);
  };

  try {
    return await attempt();
  } catch {
    return await attempt();
  }
}

const noEncounterGrade = (which: string): Grade => ({
  accuracy: 1,
  completeness: 1,
  noHallucination: 1,
  rationale: `No createEncounter call was made, so there is no ${which} to grade.`,
  pass: false,
});

function encounterInputOf(run: ScribeRun) {
  return run.toolCalls.find((call) => call.toolName === "createEncounter")
    ?.input;
}

/** Grade the SOAP note itself: structure, clarity, correct S/O/A/P placement. */
export function gradeSoapQuality(
  evalCase: ScribeEvalCase,
  run: ScribeRun
): Promise<Grade> {
  const encounter = encounterInputOf(run);
  if (!encounter) {
    return Promise.resolve(noEncounterGrade("SOAP note"));
  }
  return runGrader(
    "You are an experienced physician reviewing a SOAP note written by a " +
      "medical scribe from the transcript of a recorded clinic visit. Grade " +
      "the note's quality: is each statement in the correct section " +
      "(Subjective = what the patient reports, Objective = exam findings and " +
      "measurements, Assessment = the clinician's diagnoses and reasoning, " +
      "Plan = what will be done), is it clinically clear and specific, and " +
      "does the visit reason match the chief complaint? Vitals belong in the " +
      "structured vitals field and may also appear in Objective. Judge " +
      "quality of documentation, not quality of the medical care. Submit " +
      "your grade with the submitGrade tool.",
    `## Visit transcript (ambient audio, no speaker labels)\n${evalCase.transcript}\n\n` +
      `## The scribe's encounter (reason, vitals, SOAP note)\n${JSON.stringify(encounter, null, 2)}`
  );
}

/**
 * Grade documentation fidelity: does the full set of chart writes (problems,
 * medications, encounter) accurately document THIS visit, judged against the
 * transcript and the prior chart exactly as the scribe saw it (its own
 * context-read tool results)?
 */
export function gradeFidelity(
  evalCase: ScribeEvalCase,
  run: ScribeRun
): Promise<Grade> {
  const encounter = encounterInputOf(run);
  if (!encounter) {
    return Promise.resolve(noEncounterGrade("chart entry"));
  }

  const priorChart = run.toolResults
    .filter((result) =>
      [
        "getMedicalProblems",
        "getMedications",
        "getSurgeries",
        "getEncounters",
      ].includes(result.toolName)
    )
    .map((result) => ({ tool: result.toolName, output: result.output }));

  const chartWrites = run.toolCalls
    .filter((call) =>
      [
        "createEncounter",
        "createMedicalProblem",
        "updateMedicalProblem",
        "createMedication",
        "updateMedication",
        "createSurgery",
      ].includes(call.toolName)
    )
    .map((call) => ({ tool: call.toolName, input: call.input }));

  return runGrader(
    "You are an experienced physician auditing a medical scribe's charting " +
      "of one recorded clinic visit. You get the visit transcript, the " +
      "patient's prior chart as the scribe saw it, and every chart write the " +
      "scribe made. Grade whether the writes accurately and completely " +
      "document the visit: new diagnoses and medication changes charted if " +
      "and only if the clinician actually made them, prior conditions " +
      "reconciled rather than re-diagnosed, nothing charted that the " +
      "clinician ruled out or that never happened, and no fabricated " +
      "findings or measurements. Small talk and non-clinical chatter must " +
      "not appear in the chart. Submit your grade with the submitGrade tool.",
    `## What this case probes\n${evalCase.graderNotes}\n\n` +
      `## Visit transcript (ambient audio, no speaker labels)\n${evalCase.transcript}\n\n` +
      `## Prior chart (the scribe's own context reads)\n${JSON.stringify(priorChart, null, 2)}\n\n` +
      `## Chart writes made by the scribe\n${JSON.stringify(chartWrites, null, 2)}`
  );
}
