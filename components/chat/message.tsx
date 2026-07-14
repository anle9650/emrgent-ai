"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ToolUIPart } from "ai";
import type { ReactNode } from "react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
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
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { PendingEncounterCard } from "./encounters";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
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
          <ToolHeader state={state} type={type} />
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
          <ToolHeader state={state} type={type} />
          <ToolContent>{children}</ToolContent>
        </Tool>
      );
    }
    return <div className={TOOL_WIDTH}>{children}</div>;
  }

  return (
    <Tool className={TOOL_WIDTH} defaultOpen={true}>
      <ToolHeader state={state} type={type} />
      <ToolContent>
        {state === "input-available" && <ToolInput input={input} />}
      </ToolContent>
    </Tool>
  );
}

// Allow/Deny buttons for tool calls gated behind the human-approval flow.
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
        Allow
      </button>
    </div>
  );
}

const PurePreviewMessage = ({
  addToolApprovalResponse,
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

  const parts = message.parts?.map((part, index) => {
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;
    const isLastToolCall = index === lastToolPartIndex;

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
      return (
        <MessageContent
          className={cn("leading-[1.65]", {
            "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
              message.role === "user",
          })}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse>{sanitizeText(part.text)}</MessageResponse>
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
          <ToolHeader state={state} type={type} />
          <ToolContent>
            <ToolInput input={part.input} />
          </ToolContent>
        </Tool>
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
              <ToolHeader state={state} type={type} />
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
      const { toolCallId, state } = part;
      const approvalId = (part as { approval?: { id: string } }).approval?.id;
      const isDenied =
        state === "output-denied" ||
        (state === "approval-responded" &&
          (part as { approval?: { approved?: boolean } }).approval?.approved ===
            false);

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

      if (part.state === "output-available") {
        // Collapsed chip like the data tools — the model confirms the created
        // encounter in text (or shows it via getEncounters + EncountersCard).
        return (
          <Tool className={TOOL_WIDTH} defaultOpen={false} key={toolCallId}>
            <ToolHeader state={part.state} type={type} />
            <ToolContent>
              <PendingEncounterCard input={part.input} />
            </ToolContent>
          </Tool>
        );
      }

      if (isDenied) {
        return (
          <div className={TOOL_WIDTH} key={toolCallId}>
            <Tool className="w-full" defaultOpen={true}>
              <ToolHeader state="output-denied" type={type} />
              <ToolContent>
                <div className="px-4 py-3 text-muted-foreground text-sm">
                  Encounter creation was denied. Nothing was saved to OpenEMR.
                </div>
              </ToolContent>
            </Tool>
          </div>
        );
      }

      return (
        <div className={TOOL_WIDTH} key={toolCallId}>
          <Tool className="w-full" defaultOpen={true}>
            <ToolHeader state={state} type={type} />
            <ToolContent>
              {(part.state === "input-available" ||
                part.state === "approval-requested" ||
                part.state === "approval-responded") && (
                <PendingEncounterCard input={part.input} />
              )}
              {state === "approval-requested" && approvalId && (
                <ToolApprovalActions
                  addToolApprovalResponse={addToolApprovalResponse}
                  approvalId={approvalId}
                  denyReason="User denied creating the encounter"
                />
              )}
            </ToolContent>
          </Tool>
        </div>
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
