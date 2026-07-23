"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { Chat, useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { usePathname } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { mutateChatHistory } from "@/components/chat/sidebar-history";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import {
  isBackgroundStreamStatus,
  shouldAcceptDataPart,
  shouldAttemptAutoResume,
  shouldEvictFinishedInstance,
} from "@/lib/chat/keep-alive";
import type { Vote } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import {
  fetcher,
  fetchWithErrorHandlers,
  generateUUID,
  isToolApprovalContinuation,
  resolveDanglingToolCalls,
} from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  addToolOutput: UseChatHelpers<ChatMessage>["addToolOutput"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: VisibilityType;
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  showCreditCardAlert: boolean;
  setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDataStream } = useDataStream();
  const { mutate } = useSWRConfig();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;

  const [currentModelId, setCurrentModelId] = useState(DEFAULT_CHAT_MODEL);
  const currentModelIdRef = useRef(currentModelId);
  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const [input, setInput] = useState("");
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);

  // The locally-created chat's messages live only in useChat state while it
  // stays active. The URL flips to /chat/<id> on first send, before the
  // server row exists, so fetching here would cache an empty history for it.
  // Once the user navigates away it's demoted to a regular server-backed chat.
  const isLocalChat = chatId === newChatIdRef.current;

  const { data: chatData, isLoading } = useSWR(
    isLocalChat
      ? null
      : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const initialMessages: ChatMessage[] = isLocalChat
    ? []
    : (chatData?.messages ?? []);
  const visibility: VisibilityType = isLocalChat
    ? "private"
    : (chatData?.visibility ?? "private");

  // --- Single-slot stream keep-alive ---------------------------------------
  // We OWN the useChat `Chat` instance (via the `{ chat }` form) instead of
  // letting useChat mint a fresh empty one on every chatId change. That lets a
  // chat streaming in the background survive a brief navigation away: on return
  // we rebind to the same live instance and keep reading its in-process stream,
  // rather than reconnecting through the slower resumable-stream Redis relay.
  //
  // Scope is a SINGLE slot: only the chat we just left *while it was still
  // generating* is retained. A second chat starting its own generation displaces
  // it, and the displaced one degrades to the Redis resume on return (still
  // correct — every generation stays resumable via Redis regardless). All chats
  // remain resumable; the slot only decides which one keeps the fast path.
  //
  // In the `{ chat }` form useChat does NOT refresh the instance's callbacks/
  // transport per render (they're frozen at construction), so anything they read
  // that varies per render must come through a ref: model id, visibility, and
  // the active chat id (for onData scoping).
  const activeChatIdRef = useRef(chatId);
  activeChatIdRef.current = chatId;
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;

  const retainedRef = useRef<{
    chatId: string;
    chat: Chat<ChatMessage>;
  } | null>(null);
  const activeRef = useRef<{
    chatId: string;
    chat: Chat<ChatMessage>;
    reboundToLive: boolean;
  } | null>(null);

  const newOwnedChat = (id: string) => {
    const instanceChatId = id;
    return new Chat<ChatMessage>({
      id,
      messages: initialMessages,
      generateId: generateUUID,
      // Two resume triggers, both requiring the last step to be fully answered:
      // (a) approvals — resume only once EVERY approval in the step has been
      // answered. A step can request several at once (e.g. the scribe agent's
      // updateMedicalProblem + createEncounter); resending after the first
      // answer replays a tool call with neither result nor response, which the
      // server rejects with AI_MissingToolResultsError. Denials count as
      // answers, so an all-denied step also resumes and lets the model react.
      // (b) client tools — selectAppointmentSlot has no server execute; the
      // picker supplies its result via addToolOutput, and the run resumes once
      // every tool call in the step has a result.
      sendAutomaticallyWhen: (options) =>
        lastAssistantMessageIsCompleteWithApprovalResponses(options) ||
        lastAssistantMessageIsCompleteWithToolCalls(options),
      transport: new DefaultChatTransport({
        api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
        fetch: fetchWithErrorHandlers,
        prepareSendMessagesRequest(request) {
          return {
            body: {
              id: request.id,
              ...(isToolApprovalContinuation(request.messages)
                ? { messages: request.messages }
                : { message: request.messages.at(-1) }),
              selectedChatModel: currentModelIdRef.current,
              selectedVisibilityType: visibilityRef.current,
              ...request.body,
            },
          };
        },
      }),
      onData: (dataPart) => {
        // Only the foreground chat feeds the shared data-stream buffer; a
        // background instance's parts would pollute the active chat's artifact.
        if (shouldAcceptDataPart(instanceChatId, activeChatIdRef.current)) {
          setDataStream((ds) => (ds ? [...ds, dataPart] : []));
        }
      },
      onFinish: () => {
        mutateChatHistory(mutate);
        // A background instance finishing has nothing left to keep alive; free
        // the slot so a later return hydrates from the server / Redis resume.
        if (
          shouldEvictFinishedInstance(
            instanceChatId,
            retainedRef.current?.chatId ?? null
          )
        ) {
          retainedRef.current = null;
        }
      },
      onError: (error) => {
        if (
          error.message?.includes("AI Gateway requires a valid credit card")
        ) {
          setShowCreditCardAlert(true);
        } else if (error instanceof ChatbotError) {
          toast({ type: "error", description: error.message });
        } else {
          toast({
            type: "error",
            description: error.message || "Oops, an error occurred!",
          });
        }
      },
    });
  };

  const resolveActiveChat = (id: string) => {
    const prev = activeRef.current;
    if (prev && prev.chatId === id) {
      // Steady-state re-render: reuse the same instance (and its sticky
      // reboundToLive, so the auto-resume gate doesn't flip after mount).
      return prev;
    }

    // chatId changed. Retain the departing instance as the single background
    // slot iff it's still generating; a ready/error one is simply dropped
    // (matches the pre-keep-alive fresh-instance behavior). Not stopped — a
    // displaced live stream finishes on its own and onFinish frees the slot.
    if (prev && isBackgroundStreamStatus(prev.chat.status)) {
      retainedRef.current = { chatId: prev.chatId, chat: prev.chat };
    }

    let chat: Chat<ChatMessage>;
    let reboundToLive = false;
    if (retainedRef.current?.chatId === id) {
      chat = retainedRef.current.chat;
      reboundToLive = isBackgroundStreamStatus(chat.status);
      retainedRef.current = null; // it's foreground now
    } else {
      chat = newOwnedChat(id); // fresh instance (seeds initialMessages once)
    }

    const resolved = { chatId: id, chat, reboundToLive };
    activeRef.current = resolved;
    return resolved;
  };

  const { chat: ownedChat, reboundToLive } = resolveActiveChat(chatId);

  const {
    messages,
    setMessages,
    sendMessage: rawSendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse,
    addToolOutput,
  } = useChat<ChatMessage>({ chat: ownedChat });

  // Stop every owned instance if the provider ever hard-unmounts (it doesn't
  // during client nav — this only matters on a real teardown, where in-flight
  // fetches would die anyway; kept for tidiness / leak-safety).
  useEffect(
    () => () => {
      activeRef.current?.chat.stop();
      retainedRef.current?.chat.stop();
    },
    []
  );

  // Wrap sendMessage so that starting a new turn also resolves any still-open
  // approval cards (or an unresolved slot picker) to a "skipped" state. The
  // clinician typing instead of clicking Approve/Deny is an implicit skip;
  // without this the stale buttons linger even though the run has moved on.
  // setMessages mutates useChat's store synchronously, so the appended user
  // message that rawSendMessage adds sits after the now-resolved parts.
  const sendMessage = useCallback<UseChatHelpers<ChatMessage>["sendMessage"]>(
    (...args) => {
      setMessages((prev) => resolveDanglingToolCalls(prev));
      return rawSendMessage(...args);
    },
    [rawSendMessage, setMessages]
  );

  // On a return visit SWR serves the cached (possibly stale) history first,
  // then revalidates in the background — two successive `chatData.messages`
  // payloads for the same chat. Track the applied payload by identity so the
  // revalidated one is applied too; guarding by chat id would drop it, hiding
  // any exchange sent during the previous visit until the next navigation.
  // Skip while a send/stream is in flight (and don't retry after) so a fetch
  // that raced a new message can never clobber it.
  const appliedServerMessagesRef = useRef<ChatMessage[] | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const serverMessages = chatData?.messages;
    if (
      !serverMessages ||
      appliedServerMessagesRef.current === serverMessages
    ) {
      return;
    }
    if (
      statusRef.current === "submitted" ||
      statusRef.current === "streaming"
    ) {
      return;
    }
    appliedServerMessagesRef.current = serverMessages;
    setMessages(serverMessages);
  }, [chatData?.messages, setMessages]);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      // Switching chats discards the previous chat's useChat state; a
      // locally-created chat becomes a regular server-backed one.
      if (newChatIdRef.current === prevChatIdRef.current && !isNewChat) {
        newChatIdRef.current = generateUUID();
      }
      prevChatIdRef.current = chatId;
      if (isNewChat) {
        setMessages([]);
      }
    }
  }, [chatId, isNewChat, setMessages]);

  useEffect(() => {
    if (chatData && !isNewChat) {
      const cookieModel = document.cookie
        .split("; ")
        .find((row) => row.startsWith("chat-model="))
        ?.split("=")[1];
      if (cookieModel) {
        setCurrentModelId(decodeURIComponent(cookieModel));
      }
    }
  }, [chatData, isNewChat]);

  const hasAppendedQueryRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("query");
    if (query && !hasAppendedQueryRef.current) {
      hasAppendedQueryRef.current = true;
      window.history.replaceState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });
    }
  }, [sendMessage, chatId]);

  useAutoResume({
    // Skip the Redis reconnect when we rebound to a still-live retained
    // instance — it's already streaming in-process. Genuine resume cases (page
    // reload → empty slot; finished-while-away → evicted; waiting approval on
    // reload) all bind a non-live instance, so this preserves them.
    autoResume: shouldAttemptAutoResume({
      isNewChat,
      hasChatData: !!chatData,
      reboundToLive,
    }),
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isNewChat ? false : (chatData?.isReadonly ?? false);

  const { data: votes } = useSWR<Vote[]>(
    !isReadonly && messages.length >= 2
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      addToolOutput,
      input,
      setInput,
      visibilityType: visibility,
      isReadonly,
      isLoading: !isNewChat && isLoading,
      votes,
      currentModelId,
      setCurrentModelId,
      showCreditCardAlert,
      setShowCreditCardAlert,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      addToolOutput,
      input,
      visibility,
      isReadonly,
      isNewChat,
      isLoading,
      votes,
      currentModelId,
      showCreditCardAlert,
    ]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
