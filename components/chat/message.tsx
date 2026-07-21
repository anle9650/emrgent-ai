"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ToolUIPart } from "ai";
import type { ReactNode } from "react";
import {
  SCRIBE_TRANSCRIPT_MARKER,
  TERMINAL_TOOL_STATES,
} from "@/lib/ai/scribe";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage, ChatTools } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../ai-elements/tool";
import { EcgIcon } from "../ecg-icon";
import { A2UIView } from "./a2ui/a2ui-view";
import {
  AppointmentPicker,
  BookedSlip,
  slotSentence,
} from "./appointment-picker";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { PendingEncounterCard } from "./encounters";
import {
  PendingMedicalProblemCard,
  PendingMedicationCard,
  PendingSurgeryCard,
} from "./medical-issues";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { NextAppointmentCard } from "./next-appointment-card";
import { PendingMessageCard } from "./patient-message";
import { PreviewAttachment } from "./preview-attachment";
import { ScribeKickoffMessage } from "./scribe/kickoff-message";
import {
  ProtocolTimeline,
  type ProtocolTimelineStep,
} from "./scribe/protocol-timeline";
import { Weather } from "./weather";

function AssistantAvatar({ animated = false }: { animated?: boolean }) {
  return (
    <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
      <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <EcgIcon animated={animated} className="h-[8px] w-[20px]" />
      </div>
    </div>
  );
}

const TOOL_WIDTH = "w-full";

type MessagePart = NonNullable<ChatMessage["parts"]>[number];

// Groups a message's parts by the AI SDK's step-start boundaries — one
// segment per agent-loop step. Generic across any tool chain (scribe writes,
// a plain searchPatients -> getEncounters lookup, etc.): the model's own
// step structure is what defines one visual step in the timeline below.
type PartSegment = { parts: { part: MessagePart; index: number }[] };

function segmentByStep(parts: MessagePart[]): PartSegment[] {
  const segments: PartSegment[] = [{ parts: [] }];
  for (const [index, part] of parts.entries()) {
    if (part.type === "step-start") {
      segments.push({ parts: [] });
      continue;
    }
    segments.at(-1)?.parts.push({ part, index });
  }
  return segments.filter((segment) => segment.parts.length > 0);
}

function hasToolPart(segment: PartSegment): boolean {
  return segment.parts.some(({ part }) => part.type.startsWith("tool-"));
}

const TOOL_LABELS: Record<string, string> = {
  "tool-searchPatients": "Search patients",
  "tool-getEncounters": "Review encounters",
  "tool-getSoapNote": "Read SOAP note",
  "tool-getAppointments": "Check appointments",
  "tool-getNextAppointment": "Check next patient",
  "tool-getMedicalProblems": "Review problems",
  "tool-getMedications": "Review medications",
  "tool-getSurgeries": "Review surgical history",
  "tool-createEncounter": "Create encounter",
  "tool-createMedicalProblem": "Add problem",
  "tool-updateMedicalProblem": "Update problem",
  "tool-createMedication": "Add medication",
  "tool-updateMedication": "Update medication",
  "tool-createSurgery": "Record surgery",
  "tool-createAppointment": "Book appointment",
  "tool-sendMessage": "Send visit summary",
  "tool-selectAppointmentSlot": "Select a slot",
  "tool-generateUI": "Generate output",
  "tool-getWeather": "Check weather",
  "tool-createDocument": "Create document",
  "tool-updateDocument": "Update document",
  "tool-requestSuggestions": "Request suggestions",
};

// Fallback for any tool type not in the table above, so a newly added tool
// degrades gracefully instead of showing its raw type string.
function humanizeToolType(type: string): string {
  if (type in TOOL_LABELS) {
    return TOOL_LABELS[type];
  }
  const raw = type.replace(/^tool-/, "");
  const spaced = raw.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function labelForToolTypes(types: string[]): string {
  const labels = [...new Set(types.map((type) => humanizeToolType(type)))];
  if (labels.length <= 2) {
    return labels.join(" & ");
  }
  return "";
}

// Shared shell for tool parts that render a rich result card. Covers the
// uniform states: error (expanded red text), pending (header + parameters),
// and a successful result shown either inline (`expanded`, the message's
// final tool call) or behind a closed, still-expandable tool header.
function ToolPartView({
  type,
  state,
  input,
  error,
  expanded = true,
  children,
}: {
  type: ToolUIPart["type"];
  state: ToolUIPart["state"];
  input?: unknown;
  error?: string;
  expanded?: boolean;
  children?: ReactNode;
}) {
  if (error !== undefined) {
    return (
      <div className={TOOL_WIDTH}>
        <Tool className="w-full" defaultOpen={true}>
          <ToolHeader
            state={state}
            title={humanizeToolType(type)}
            type={type}
          />
          <ToolContent>
            <div className="px-4 py-3 text-negative text-sm">{error}</div>
          </ToolContent>
        </Tool>
      </div>
    );
  }

  if (children) {
    if (!expanded) {
      return (
        <Tool className={TOOL_WIDTH} defaultOpen={false}>
          <ToolHeader
            state={state}
            title={humanizeToolType(type)}
            type={type}
          />
          <ToolContent>{children}</ToolContent>
        </Tool>
      );
    }
    return <div className={TOOL_WIDTH}>{children}</div>;
  }

  return (
    <Tool className={TOOL_WIDTH} defaultOpen={true}>
      <ToolHeader state={state} title={humanizeToolType(type)} type={type} />
      <ToolContent>
        {state === "input-available" && <ToolInput input={input} />}
      </ToolContent>
    </Tool>
  );
}

// Shared shell for write tools gated behind clinician approval: error card,
// collapsed success chip, denial notice, or pending card + approval buttons.
// Covers createEncounter, create/updateMedicalProblem, create/updateMedication,
// createSurgery, and sendMessage — all of which follow this exact shape.
function ApprovalGatedToolView<
  TPart extends {
    type: ToolUIPart["type"];
    toolCallId: string;
    state: string;
    input?: unknown;
    output?: unknown;
  },
>({
  part,
  deniedMessage,
  denyReason,
  addToolApprovalResponse,
  renderCard,
}: {
  part: TPart;
  deniedMessage: string;
  denyReason: string;
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  renderCard: (input: unknown) => ReactNode;
}) {
  const { type, toolCallId, state } = part;
  const toolState = state as ToolUIPart["state"];

  if (
    state === "output-available" &&
    part.output &&
    typeof part.output === "object" &&
    "error" in part.output
  ) {
    return (
      <ToolPartView
        error={String((part.output as { error: unknown }).error)}
        key={toolCallId}
        state={toolState}
        type={type}
      />
    );
  }

  if (state === "output-available") {
    // Collapsed chip like the data tools — the model confirms the write in
    // text (or shows it via the matching read tool + card).
    return (
      <Tool className={TOOL_WIDTH} defaultOpen={false} key={toolCallId}>
        <ToolHeader
          state={toolState}
          title={humanizeToolType(type)}
          type={type}
        />
        <ToolContent>{renderCard(part.input)}</ToolContent>
      </Tool>
    );
  }

  const approvalId = (part as { approval?: { id: string } }).approval?.id;
  const isDenied =
    state === "output-denied" ||
    (state === "approval-responded" &&
      (part as { approval?: { approved?: boolean } }).approval?.approved ===
        false);

  if (isDenied) {
    return (
      <div className={TOOL_WIDTH} key={toolCallId}>
        <Tool className="w-full" defaultOpen={true}>
          <ToolHeader
            state="output-denied"
            title={humanizeToolType(type)}
            type={type}
          />
          <ToolContent>
            <div className="px-4 py-3 text-muted-foreground text-sm">
              {deniedMessage}
            </div>
          </ToolContent>
        </Tool>
      </div>
    );
  }

  return (
    <div className={TOOL_WIDTH} key={toolCallId}>
      <Tool className="w-full" defaultOpen={true}>
        <ToolHeader
          state={toolState}
          title={humanizeToolType(type)}
          type={type}
        />
        <ToolContent>
          {(state === "input-available" ||
            state === "approval-requested" ||
            state === "approval-responded") &&
            renderCard(part.input)}
          {state === "approval-requested" && approvalId && (
            <ToolApprovalActions
              addToolApprovalResponse={addToolApprovalResponse}
              approvalId={approvalId}
              denyReason={denyReason}
            />
          )}
        </ToolContent>
      </Tool>
    </div>
  );
}

// Approve/Deny buttons for tool calls gated behind the human-approval flow.
function ToolApprovalActions({
  approvalId,
  denyReason,
  addToolApprovalResponse,
}: {
  approvalId: string;
  denyReason: string;
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
      <button
        className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => {
          addToolApprovalResponse({
            id: approvalId,
            approved: false,
            reason: denyReason,
          });
        }}
        type="button"
      >
        Deny
      </button>
      <button
        className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90"
        onClick={() => {
          addToolApprovalResponse({
            id: approvalId,
            approved: true,
          });
        }}
        type="button"
      >
        Approve
      </button>
    </div>
  );
}

const PurePreviewMessage = ({
  addToolApprovalResponse,
  addToolOutput,
  chatId,
  message,
  vote,
  isLoading,
  setMessages: _setMessages,
  regenerate: _regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  addToolOutput: UseChatHelpers<ChatMessage>["addToolOutput"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  onEdit?: (message: ChatMessage) => void;
}) => {
  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0) ||
      part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const attachments = attachmentsFromMessage.length > 0 && (
    <div
      className="flex flex-row justify-end gap-2"
      data-testid={"message-attachments"}
    >
      {attachmentsFromMessage.map((attachment) => (
        <PreviewAttachment
          attachment={{
            name: attachment.filename ?? "file",
            contentType: attachment.mediaType,
            url: attachment.url,
          }}
          key={attachment.url}
        />
      ))}
    </div>
  );

  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false,
        };
      }
      return acc;
    },
    { text: "", isStreaming: false, rendered: false }
  ) ?? { text: "", isStreaming: false, rendered: false };

  // Rich tool UI is reserved for the message's final tool call; earlier calls
  // in a chain (e.g. searchPatients -> getEncounters -> getSoapNote) collapse
  // into closed tool headers, still expandable on click. Errors stay expanded.
  const lastToolPartIndex =
    message.parts?.reduce(
      (last, part, index) => (part.type.startsWith("tool-") ? index : last),
      -1
    ) ?? -1;

  // Extracted so it can render both the flat part list below and the
  // content nested inside each ProtocolTimeline step (see hasTimeline).
  function renderPart(
    part: MessagePart,
    index: number,
    isLastToolCallOverride?: boolean
  ): ReactNode {
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;
    const isLastToolCall =
      isLastToolCallOverride ?? index === lastToolPartIndex;

    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return (
          <MessageReasoning
            isLoading={isLoading || mergedReasoning.isStreaming}
            key={key}
            reasoning={mergedReasoning.text}
          />
        );
      }
      return null;
    }

    if (type === "text") {
      const isScribeKickoff =
        message.role === "user" && part.text.includes(SCRIBE_TRANSCRIPT_MARKER);
      return (
        <MessageContent
          className={cn("leading-[1.65]", {
            // Scribe kickoffs render their own full-width note banner; only
            // plain user text gets the chat-bubble chrome.
            "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
              message.role === "user" && !isScribeKickoff,
            "w-full": isScribeKickoff,
          })}
          data-testid="message-content"
          key={key}
        >
          {isScribeKickoff ? (
            <ScribeKickoffMessage text={part.text} />
          ) : (
            <MessageResponse>{sanitizeText(part.text)}</MessageResponse>
          )}
        </MessageContent>
      );
    }

    if (
      type === "tool-searchPatients" ||
      type === "tool-getEncounters" ||
      type === "tool-getAppointments" ||
      type === "tool-getMedicalProblems" ||
      type === "tool-getMedications" ||
      type === "tool-getSurgeries" ||
      type === "tool-getSoapNote"
    ) {
      const { toolCallId, state } = part;

      if (
        state === "output-available" &&
        part.output &&
        "error" in part.output
      ) {
        return (
          <ToolPartView
            error={String(part.output.error)}
            key={toolCallId}
            state={state}
            type={type}
          />
        );
      }

      // Data tools render only their name and params (behind a collapsed tool
      // header) — showing the data is the model's call, via generateUI.
      return (
        <Tool className={TOOL_WIDTH} defaultOpen={false} key={toolCallId}>
          <ToolHeader
            state={state}
            title={humanizeToolType(type)}
            type={type}
          />
          <ToolContent>
            <ToolInput input={part.input} />
          </ToolContent>
        </Tool>
      );
    }

    if (type === "tool-selectAppointmentSlot") {
      const { toolCallId, state } = part;

      // Resolved: a compact record of the clinician's choice. The picker's
      // full ledger is transient — once a slot is booked (or skipped) it
      // collapses to a one-liner so the closing surface can breathe.
      if (state === "output-available") {
        const { output } = part;
        return (
          <div
            className="flex items-center gap-2 px-0.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]"
            key={toolCallId}
          >
            {"skipped" in output
              ? "Scheduling skipped"
              : `Selected · ${slotSentence(output.chosenSlot)}`}
          </div>
        );
      }

      // The no-execute tool has paused the run: render the interactive picker.
      // It self-fetches candidates and resolves the call via addToolOutput.
      // On a read-only/historical render (no resolver) the picker renders inert.
      if (state === "input-available") {
        return (
          <div className={TOOL_WIDTH} key={toolCallId}>
            <AppointmentPicker
              onResolved={
                isReadonly
                  ? undefined
                  : (result) =>
                      addToolOutput({
                        tool: "selectAppointmentSlot",
                        toolCallId,
                        output: result,
                      })
              }
              params={part.input}
            />
          </div>
        );
      }

      return null;
    }

    if (type === "tool-createAppointment") {
      const { toolCallId, state } = part;

      if (
        state === "output-available" &&
        part.output &&
        "error" in part.output
      ) {
        return (
          <ToolPartView
            error={String(part.output.error)}
            key={toolCallId}
            state={state}
            type={type}
          />
        );
      }

      if (state === "output-available" && part.output?.results) {
        return (
          <div className={TOOL_WIDTH} key={toolCallId}>
            <BookedSlip slot={part.output.results.booked} />
          </div>
        );
      }

      // Transient: the booking POST is in flight.
      return (
        <div
          className="flex items-center gap-2 px-0.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]"
          key={toolCallId}
        >
          Booking…
        </div>
      );
    }

    if (type === "tool-getNextAppointment") {
      const { toolCallId, state } = part;

      if (
        state === "output-available" &&
        part.output &&
        "error" in part.output
      ) {
        return (
          <ToolPartView
            error={String(part.output.error)}
            key={toolCallId}
            state={state}
            type={type}
          />
        );
      }

      if (state === "output-available") {
        // `results` is the next roomed appointment, or null when no one else
        // is waiting — say so quietly rather than rendering an empty card.
        if (part.output?.results) {
          return (
            <div className={TOOL_WIDTH} key={toolCallId}>
              <NextAppointmentCard appointment={part.output.results} />
            </div>
          );
        }
        return (
          <div
            className="px-0.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]"
            key={toolCallId}
          >
            No other patients in an exam room.
          </div>
        );
      }

      // Transient: the schedule lookup is in flight.
      return (
        <div
          className="flex items-center gap-2 px-0.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]"
          key={toolCallId}
        >
          Checking the schedule…
        </div>
      );
    }

    if (type === "tool-generateUI") {
      const { toolCallId, state } = part;

      if (state === "output-available") {
        // A rejected spec is model machinery, not an answer — the model
        // retries with a corrected spec, so keep the failure collapsed
        // instead of shouting above the successful surface that follows.
        if ("error" in part.output) {
          return (
            <Tool className={TOOL_WIDTH} defaultOpen={false} key={toolCallId}>
              <ToolHeader
                state={state}
                title={humanizeToolType(type)}
                type={type}
              />
              <ToolContent>
                <div className="px-4 py-3 text-negative text-sm">
                  {String(part.output.error)}
                </div>
              </ToolContent>
            </Tool>
          );
        }

        // The surface renders full-width without tool chrome — it *is* the
        // assistant's answer, composed from the trusted component catalog.
        return (
          <div className={TOOL_WIDTH} key={toolCallId}>
            <A2UIView spec={part.input} />
          </div>
        );
      }

      return (
        <div
          className="flex animate-pulse flex-col gap-2.5 rounded-xl border border-border/50 bg-card px-3.5 py-3 shadow-(--shadow-card)"
          key={toolCallId}
        >
          <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
            Composing view…
          </div>
          <div className="h-14 rounded-lg bg-muted/60" />
        </div>
      );
    }

    if (type === "tool-getWeather") {
      const { toolCallId, state } = part;
      const approvalId = (part as { approval?: { id: string } }).approval?.id;
      const isDenied =
        state === "output-denied" ||
        (state === "approval-responded" &&
          (part as { approval?: { approved?: boolean } }).approval?.approved ===
            false);
      const widthClass = TOOL_WIDTH;

      if (state === "output-available") {
        return (
          <ToolPartView
            expanded={isLastToolCall}
            key={toolCallId}
            state={state}
            type={type}
          >
            <Weather weatherAtLocation={part.output} />
          </ToolPartView>
        );
      }

      if (isDenied) {
        return (
          <div className={widthClass} key={toolCallId}>
            <Tool className="w-full" defaultOpen={true}>
              <ToolHeader state="output-denied" type="tool-getWeather" />
              <ToolContent>
                <div className="px-4 py-3 text-muted-foreground text-sm">
                  Weather lookup was denied.
                </div>
              </ToolContent>
            </Tool>
          </div>
        );
      }

      if (state === "approval-responded") {
        return (
          <div className={widthClass} key={toolCallId}>
            <Tool className="w-full" defaultOpen={true}>
              <ToolHeader state={state} type="tool-getWeather" />
              <ToolContent>
                <ToolInput input={part.input} />
              </ToolContent>
            </Tool>
          </div>
        );
      }

      return (
        <div className={widthClass} key={toolCallId}>
          <Tool className="w-full" defaultOpen={true}>
            <ToolHeader state={state} type="tool-getWeather" />
            <ToolContent>
              {(state === "input-available" ||
                state === "approval-requested") && (
                <ToolInput input={part.input} />
              )}
              {state === "approval-requested" && approvalId && (
                <ToolApprovalActions
                  addToolApprovalResponse={addToolApprovalResponse}
                  approvalId={approvalId}
                  denyReason="User denied weather lookup"
                />
              )}
            </ToolContent>
          </Tool>
        </div>
      );
    }

    if (type === "tool-createEncounter") {
      return (
        <ApprovalGatedToolView
          addToolApprovalResponse={addToolApprovalResponse}
          deniedMessage="Encounter creation was denied. Nothing was saved to OpenEMR."
          denyReason="User denied creating the encounter"
          key={part.toolCallId}
          part={part}
          renderCard={(input) => (
            <PendingEncounterCard
              input={input as ChatTools["createEncounter"]["input"]}
            />
          )}
        />
      );
    }

    if (
      type === "tool-createMedicalProblem" ||
      type === "tool-updateMedicalProblem"
    ) {
      const isUpdate = type === "tool-updateMedicalProblem";
      return (
        <ApprovalGatedToolView
          addToolApprovalResponse={addToolApprovalResponse}
          deniedMessage={
            isUpdate
              ? "Updating the problem was denied. Nothing was changed in OpenEMR."
              : "Adding the problem was denied. Nothing was saved to OpenEMR."
          }
          denyReason={
            isUpdate
              ? "User denied updating the medical problem"
              : "User denied adding the medical problem"
          }
          key={part.toolCallId}
          part={part}
          renderCard={(input) => (
            <PendingMedicalProblemCard
              input={
                input as
                  | ChatTools["createMedicalProblem"]["input"]
                  | ChatTools["updateMedicalProblem"]["input"]
              }
            />
          )}
        />
      );
    }

    if (type === "tool-createMedication" || type === "tool-updateMedication") {
      const isUpdate = type === "tool-updateMedication";
      return (
        <ApprovalGatedToolView
          addToolApprovalResponse={addToolApprovalResponse}
          deniedMessage={
            isUpdate
              ? "Updating the medication was denied. Nothing was changed in OpenEMR."
              : "Adding the medication was denied. Nothing was saved to OpenEMR."
          }
          denyReason={
            isUpdate
              ? "User denied updating the medication"
              : "User denied adding the medication"
          }
          key={part.toolCallId}
          part={part}
          renderCard={(input) => (
            <PendingMedicationCard
              input={
                input as
                  | ChatTools["createMedication"]["input"]
                  | ChatTools["updateMedication"]["input"]
              }
            />
          )}
        />
      );
    }

    if (type === "tool-createSurgery") {
      return (
        <ApprovalGatedToolView
          addToolApprovalResponse={addToolApprovalResponse}
          deniedMessage="Recording the surgery was denied. Nothing was saved to OpenEMR."
          denyReason="User denied recording the surgery"
          key={part.toolCallId}
          part={part}
          renderCard={(input) => (
            <PendingSurgeryCard
              input={input as ChatTools["createSurgery"]["input"]}
            />
          )}
        />
      );
    }

    if (type === "tool-sendMessage") {
      return (
        <ApprovalGatedToolView
          addToolApprovalResponse={addToolApprovalResponse}
          deniedMessage="Sending the message was denied. Nothing was sent to the patient."
          denyReason="User denied sending the portal message"
          key={part.toolCallId}
          part={part}
          renderCard={(input) => (
            <PendingMessageCard
              input={input as ChatTools["sendMessage"]["input"]}
            />
          )}
        />
      );
    }

    if (type === "tool-createDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-negative/25 bg-negative/10 p-4 text-negative"
            key={toolCallId}
          >
            Error creating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <DocumentPreview
          isReadonly={isReadonly}
          key={toolCallId}
          result={part.output}
        />
      );
    }

    if (type === "tool-updateDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-negative/25 bg-negative/10 p-4 text-negative"
            key={toolCallId}
          >
            Error updating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <div className="relative" key={toolCallId}>
          <DocumentPreview
            args={{ ...part.output, isUpdate: true }}
            isReadonly={isReadonly}
            result={part.output}
          />
        </div>
      );
    }

    if (type === "tool-requestSuggestions") {
      const { toolCallId, state } = part;

      return (
        <Tool className={TOOL_WIDTH} defaultOpen={true} key={toolCallId}>
          <ToolHeader state={state} type="tool-requestSuggestions" />
          <ToolContent>
            {state === "input-available" && <ToolInput input={part.input} />}
            {state === "output-available" && (
              <ToolOutput
                errorText={undefined}
                output={
                  "error" in part.output ? (
                    <div className="rounded border p-2 text-negative">
                      Error: {String(part.output.error)}
                    </div>
                  ) : (
                    <DocumentToolResult
                      isReadonly={isReadonly}
                      result={part.output}
                      type="request-suggestions"
                    />
                  )
                }
              />
            )}
          </ToolContent>
        </Tool>
      );
    }

    return null;
  }

  // Group this message's tool-call parts by AI SDK step-start boundaries —
  // one segment per agent-loop step — and connect them with a vertical
  // timeline once there are at least two. A single lone tool call (the
  // common case) renders exactly as before, with no timeline chrome.
  const segments = isAssistant ? segmentByStep(message.parts ?? []) : [];
  const toolSegments = segments.filter(hasToolPart);
  const hasTimeline = toolSegments.length >= 2;
  const firstTimelinePartIndex = hasTimeline
    ? toolSegments[0].parts[0].index
    : -1;
  const timelinePartIndexSet = hasTimeline
    ? new Set(
        toolSegments.flatMap((segment) => segment.parts.map((p) => p.index))
      )
    : new Set<number>();

  function buildTimelineSteps(): ProtocolTimelineStep[] {
    return toolSegments.map((segment, stepIndex) => {
      const toolTypes = [
        ...new Set(
          segment.parts
            .map(({ part }) => part.type)
            .filter((type) => type.startsWith("tool-"))
        ),
      ];
      const settled = segment.parts
        .filter(({ part }) => part.type.startsWith("tool-"))
        .every(
          ({ part }) =>
            "state" in part &&
            TERMINAL_TOOL_STATES.has((part as { state: string }).state)
        );
      return {
        id: `step-${stepIndex}`,
        label: labelForToolTypes(toolTypes),
        settled,
        content: (
          <div className="flex flex-col gap-2">
            {segment.parts.map(({ part, index }) => (
              <div key={`${part.type}-${index}`}>
                {renderPart(part, index, false)}
              </div>
            ))}
          </div>
        ),
      };
    });
  }

  const parts = message.parts?.map((part, index) => {
    if (hasTimeline && timelinePartIndexSet.has(index)) {
      if (index !== firstTimelinePartIndex) {
        return null;
      }
      return (
        <ProtocolTimeline
          key={`timeline-${message.id}`}
          steps={buildTimelineSteps()}
        />
      );
    }
    return renderPart(part, index);
  });

  const actions = !isReadonly && (
    <MessageActions
      chatId={chatId}
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
      onEdit={onEdit ? () => onEdit(message) : undefined}
      vote={vote}
    />
  );

  const content = isThinking ? (
    <div className="flex h-[calc(13px*1.65)] items-center leading-[1.65]">
      <Shimmer className="font-medium" duration={1}>
        Thinking...
      </Shimmer>
    </div>
  ) : (
    <>
      {attachments}
      {parts}
      {actions}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      )}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3"
        )}
      >
        {isAssistant ? (
          <>
            <div
              className={cn(
                "shrink-0 overflow-x-clip transition-all duration-500",
                isLoading ? "w-7 opacity-100" : "-ml-3 w-0 opacity-0"
              )}
            >
              <AssistantAvatar animated={isLoading} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">{content}</div>
          </>
        ) : (
          content
        )}
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => (
  <div
    className="group/message w-full"
    data-role="assistant"
    data-testid="message-assistant-loading"
  >
    <div className="flex items-start gap-3">
      <AssistantAvatar animated />

      <div className="flex h-[calc(13px*1.65)] items-center leading-[1.65]">
        <Shimmer className="font-medium" duration={1}>
          Thinking...
        </Shimmer>
      </div>
    </div>
  </div>
);
