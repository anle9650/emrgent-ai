import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { scribeChatTitle } from "@/lib/ai/scribe";
import { createDocument } from "@/lib/ai/tools/create-document";
import { editDocument } from "@/lib/ai/tools/edit-document";
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
  getSoapNote,
  getSurgeries,
  searchPatients,
  sendMessage,
  updateMedicalProblem,
  updateMedication,
} from "@/lib/ai/tools/openemr";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { selectAppointmentSlot } from "@/lib/ai/tools/select-appointment-slot";
import { updateDocument } from "@/lib/ai/tools/update-document";
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
} from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
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

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
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

    const modelMessages = await convertToModelMessages(uiMessages);

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        // Live registry of this run's tool calls (toolCallId -> toolName).
        // generateUI validates `sourceToolCallId` refs against it, because
        // execute()'s `messages` can't see calls made in the same step.
        const seenToolCalls = new Map<string, string>();

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
          },
          activeTools:
            isReasoningModel && !supportsTools
              ? []
              : [
                  "searchPatients",
                  "getEncounters",
                  "getSoapNote",
                  "getAppointments",
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
                  "generateUI",
                  "getWeather",
                  "createDocument",
                  "editDocument",
                  "updateDocument",
                  "requestSuggestions",
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
            generateUI: generateUI({ seenToolCalls }),
            getWeather,
            createDocument: createDocument({
              session,
              dataStream,
              modelId: chatModel,
            }),
            editDocument: editDocument({ dataStream, session }),
            updateDocument: updateDocument({
              session,
              dataStream,
              modelId: chatModel,
            }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
              modelId: chatModel,
            }),
          },
          onChunk: ({ chunk }) => {
            if (chunk.type === "tool-call") {
              seenToolCalls.set(chunk.toolCallId, chunk.toolName);
            }
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
            const streamId = generateId();
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
