import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { createMergeMcpTools } from "@/lib/ai/mcp/merge";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { scribeChatTitle } from "@/lib/ai/scribe";
import { generateUI } from "@/lib/ai/tools/generate-ui";
import { getWeather } from "@/lib/ai/tools/get-weather";
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
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import {
  convertToUIMessages,
  generateUUID,
  getTextFromMessage,
  resolveDanglingToolCalls,
} from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

// Allow-list of the app's own tools that may run when the model supports tools.
// MCP-provided tool names are appended at request time in the streamText call.
const BUILT_IN_ACTIVE_TOOLS = [
  "searchPatients",
  "getEncounters",
  "getSoapNote",
  "getAppointments",
  "getNextAppointment",
  "selectAppointmentSlot",
  "createAppointment",
  "getMedicalProblems",
  "getMedications",
  "getSurgeries",
  "createEncounter",
  "createMedicalProblem",
  "updateMedicalProblem",
  "createMedication",
  "updateMedication",
  "createSurgery",
  "sendMessage",
  "sendReferral",
  "generateUI",
  "getWeather",
] as const;

// Memoized so the Redis publisher/subscriber clients connect once and are
// reused across requests. Creating a fresh context per call opened (and leaked)
// two new Upstash connections with a TLS handshake on every message — added
// latency on every response and burns through Upstash's connection limit.
// `null` means unavailable (no REDIS_URL / init failed); we retry next call.
let streamContext: ReturnType<typeof createResumableStreamContext> | null =
  null;

function getStreamContext() {
  if (streamContext) {
    return streamContext;
  }
  try {
    streamContext = createResumableStreamContext({ waitUntil: after });
    return streamContext;
  } catch {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const [, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    if (isProductionEnvironment) {
      const messageCount = await getMessageCountByUserId({
        id: session.user.id,
        differenceInHours: 1,
      });

      if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
        return new ChatbotError("rate_limit:chat").toResponse();
      }
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
        kind: requestBody.kind ?? "chat",
      });
      // Scribe sessions get a deterministic title (patient name + visit
      // date) parsed from the kickoff; anything unparseable falls back to
      // the generated title.
      const kickoffTitle =
        requestBody.kind === "scribe"
          ? scribeChatTitle(getTextFromMessage(message as ChatMessage))
          : null;
      titlePromise = kickoffTitle
        ? Promise.resolve(kickoffTitle)
        : generateTitleFromUserMessage({ message });
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);
      // Overlay the states the client resolved while the run was paused, keyed
      // by toolCallId: approval answers (approval-responded / output-denied)
      // AND client-tool results (output-available / output-error) — the latter
      // for no-execute tools like selectAppointmentSlot, whose result the
      // picker supplies via addToolOutput. Dropping it would hang the run.
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied" ||
                  p.state === "output-available" ||
                  p.state === "output-error"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];

      // An approval-shaped request can still carry a brand-new user message
      // (a send racing an in-flight approval response, or a misrouted client).
      // Without this it would vanish: the approval branch rebuilds context
      // from the DB and the user-message save below is skipped.
      const lastRequestMessage = messages.at(-1);
      if (
        lastRequestMessage?.role === "user" &&
        !messagesFromDb.some((m) => m.id === lastRequestMessage.id)
      ) {
        uiMessages.push(lastRequestMessage as ChatMessage);
        await saveMessages({
          messages: [
            {
              chatId: id,
              id: lastRequestMessage.id,
              role: "user",
              parts: lastRequestMessage.parts,
              attachments: [],
              createdAt: new Date(),
            },
          ],
        });
      }
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    const { longitude, latitude, city, countryRegion, postalCode, country } =
      geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      state: countryRegion,
      postalCode,
      country,
      timezone:
        request.headers.get("x-vercel-ip-timezone") ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const modelConfig = chatModels.find((m) => m.id === chatModel);
    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;

    // Neutralize any tool call left dangling by an unanswered approval or an
    // abandoned client tool (e.g. a new message sent before approving a write
    // or picking a slot). Without this, convertToModelMessages throws
    // AI_MissingToolResultsError and — since the dangling part is persisted —
    // the chat stays poisoned on every later send. Persist the neutralized
    // parts too, so the skip survives a reload instead of the stale approval
    // card reappearing. resolveDanglingToolCalls only ever rewrites assistant
    // messages, which all originate from the DB, and returns changed ones as
    // new objects (unchanged ones by identity) — so the reference check below
    // is exactly the set to write back, and in the common case (nothing
    // dangling) no writes happen at all.
    const sanitizedUiMessages = resolveDanglingToolCalls(uiMessages);
    await Promise.all(
      sanitizedUiMessages
        .filter((m, i) => m !== uiMessages[i])
        .map((m) => updateMessage({ id: m.id, parts: m.parts }))
    );
    uiMessages = sanitizedUiMessages;

    const modelMessages = await convertToModelMessages(uiMessages);

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        // Live registry of this run's tool calls (toolCallId -> toolName).
        // generateUI validates `sourceToolCallId` refs against it, because
        // execute()'s `messages` can't see calls made in the same step.
        const seenToolCalls = new Map<string, string>();

        // NPI Registry provider search, served over MCP by Merge Agent Handler.
        // Null when Merge is unconfigured or unreachable — the chat then runs
        // without the tool. The client stays open for the whole stream and is
        // closed in onFinish/onError below.
        const merge = await createMergeMcpTools();

        const result = streamText({
          model: getLanguageModel(chatModel),
          instructions: systemPrompt({
            requestHints,
            supportsTools,
            openEmrConnected: Boolean(session.openemr?.accessToken),
          }),
          messages: modelMessages,
          // Enough steps for a data-gathering chain plus a generateUI call and
          // a closing text step — sized for the scribe flow's worst case
          // (4 history reads -> several create/update writes ->
          // createEncounter -> getEncounters -> generateUI -> text). Approval
          // continuations reset the budget.
          stopWhen: isStepCount(16),
          // createEncounter/createMedicalProblem write to OpenEMR — the user
          // must approve each call in the chat UI before it executes.
          toolApproval: {
            createEncounter: "user-approval",
            createMedicalProblem: "user-approval",
            updateMedicalProblem: "user-approval",
            createMedication: "user-approval",
            updateMedication: "user-approval",
            createSurgery: "user-approval",
            sendMessage: "user-approval",
            sendReferral: "user-approval",
          },
          activeTools:
            isReasoningModel && !supportsTools
              ? []
              : [
                  ...BUILT_IN_ACTIVE_TOOLS,
                  // MCP-provided tools (e.g. NPI provider search). activeTools
                  // is an allow-list, so unlisted tools stay inert. Cast to the
                  // built-in union — the AI SDK types activeTools to the
                  // statically-known keys, but these are valid keys at runtime.
                  ...(merge
                    ? (Object.keys(
                        merge.tools
                      ) as (typeof BUILT_IN_ACTIVE_TOOLS)[number][])
                    : []),
                ],
          providerOptions: {
            ...(modelConfig?.gatewayOrder && {
              gateway: { order: modelConfig.gatewayOrder },
            }),
            ...(modelConfig?.reasoningEffort && {
              openai: { reasoningEffort: modelConfig.reasoningEffort },
            }),
          },
          tools: {
            searchPatients,
            getEncounters,
            getSoapNote,
            getAppointments,
            getNextAppointment,
            selectAppointmentSlot,
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
            generateUI: generateUI({ seenToolCalls }),
            getWeather,
            ...merge?.tools,
          },
          onChunk: ({ chunk }) => {
            if (chunk.type === "tool-call") {
              seenToolCalls.set(chunk.toolCallId, chunk.toolName);
            }
          },
          onFinish: async () => {
            await merge?.client.close().catch(() => {
              /* best-effort cleanup */
            });
          },
          onError: async () => {
            await merge?.client.close().catch(() => {
              /* best-effort cleanup */
            });
          },
          telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
        });

        dataStream.merge(
          toUIMessageStream({
            stream: result.stream,
            sendReasoning: isReasoningModel,
          })
        );

        if (titlePromise) {
          try {
            const title = await titlePromise;
            dataStream.write({ type: "data-chat-title", data: title });
            updateChatTitleById({ chatId: id, title });
          } catch {
            /* non-fatal */
          }
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                  },
                ],
              });
            }
          }
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: (error) => {
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
        }
        return "Oops, an error occurred!";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            // Must be a UUID: the Stream.id column is `uuid`, so a non-UUID id
            // (e.g. AI SDK's generateId nanoid) makes createStreamId throw —
            // silently, via the catch below — leaving the stream unregistered
            // and every resume a no-op.
            const streamId = generateUUID();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch {
          /* non-critical */
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
