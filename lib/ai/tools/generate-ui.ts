import { tool } from "ai";
import {
  type A2UISpec,
  DOMAIN_CARD_SOURCES,
  generateUiInputSchema,
  validateSurface,
} from "@/lib/ai/a2ui/schema";

// Tool names (no "tool-" part-type prefix) each domain card may source from.
const DOMAIN_CARD_TOOL_NAMES = Object.fromEntries(
  Object.entries(DOMAIN_CARD_SOURCES).map(([card, partTypes]) => [
    card,
    new Set(partTypes.map((partType) => partType.replace(/^tool-/, ""))),
  ])
) as Record<keyof typeof DOMAIN_CARD_SOURCES, Set<string>>;

// Check every domain card's `sourceToolCallId` against the tool calls the
// model has actually made, so a hallucinated or mistyped id fails here —
// retryably — instead of client-side.
function validateSources(
  spec: A2UISpec,
  toolCallsById: ReadonlyMap<string, string>
): string[] {
  const errors: string[] = [];
  for (const component of spec.components) {
    if (!("sourceToolCallId" in component)) {
      continue;
    }
    const toolName = toolCallsById.get(component.sourceToolCallId);
    if (toolName === undefined) {
      errors.push(
        `Component "${component.id}": no prior tool call with toolCallId "${component.sourceToolCallId}". Copy the \`sourceToolCallId\` field verbatim from the data tool's result — do not invent one.`
      );
    } else if (!DOMAIN_CARD_TOOL_NAMES[component.component].has(toolName)) {
      errors.push(
        `Component "${component.id}": ${component.component} cannot render output of \`${toolName}\`.`
      );
    }
  }
  return errors;
}

// Factory: `seenToolCalls` is a per-request registry of toolCallId -> toolName
// the chat route fills from `onChunk` as calls stream in. It's needed because
// execute's `messages` option excludes the assistant response containing the
// current call — a data tool called in the *same step* as generateUI would
// otherwise be invisible here and get falsely rejected.
export function generateUI({
  seenToolCalls,
}: {
  seenToolCalls: ReadonlyMap<string, string>;
}) {
  return tool({
    description:
      "Render UI in the chat from the component catalog. Use domain cards to display data returned by the data tools — the user cannot see raw tool output. Bind each domain card by copying the `sourceToolCallId` field verbatim from the tool's result. Compose with layout/content primitives for comparisons and summaries. Do not call it when a short text answer suffices.",
    inputSchema: generateUiInputSchema,
    // biome-ignore lint/suspicious/useAwait: `tool()` expects an async execute.
    execute: async (input, { messages }) => {
      // Prior-turn calls come from replayed messages; current-run calls
      // (including same-step ones) come from the live registry.
      const toolCallsById = new Map(seenToolCalls);
      for (const message of messages) {
        if (message.role !== "assistant" || !Array.isArray(message.content)) {
          continue;
        }
        for (const part of message.content) {
          if (part.type === "tool-call") {
            toolCallsById.set(part.toolCallId, part.toolName);
          }
        }
      }

      const errors = [
        ...validateSurface(input),
        ...validateSources(input, toolCallsById),
      ];
      if (errors.length > 0) {
        return { error: `Invalid UI: ${errors.join(" ")}` };
      }
      // The client renders from `part.input`; the output just confirms validity.
      return { ok: true as const };
    },
  });
}
