"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useEffect, useRef } from "react";
import { useDataStream } from "@/components/chat/data-stream-provider";
import type { ChatMessage } from "@/lib/types";
import { messageHasOpenToolPause } from "@/lib/utils";

export type UseAutoResumeParams = {
  autoResume: boolean;
  initialMessages: ChatMessage[];
  resumeStream: UseChatHelpers<ChatMessage>["resumeStream"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
};

export function useAutoResume({
  autoResume,
  initialMessages,
  resumeStream,
  setMessages,
}: UseAutoResumeParams) {
  const { dataStream } = useDataStream();

  // Dedupe by resumeStream identity. Each owned Chat instance has its own
  // resumeStream, so this fires once per instance. A fresh instance (page
  // reload, or a chat evicted from the keep-alive slot) gets a new identity and
  // re-attempts resume; a chat rebound to its retained live instance keeps the
  // same identity and is additionally gated off by `autoResume` (the provider
  // passes false via shouldAttemptAutoResume when reboundToLive). resumeStream
  // identity is also what re-triggers this effect on a chat switch (the
  // persistent provider never unmounts), so it is the correct dep — the
  // previous `initialMessages.at` dep was a no-op (Array.prototype.at is stable
  // across all arrays).
  const resumedRef = useRef<typeof resumeStream | null>(null);

  useEffect(() => {
    if (!autoResume) {
      return;
    }

    if (resumedRef.current === resumeStream) {
      return;
    }

    // Resume when the last message is a user turn (a normal in-flight send) OR
    // an assistant turn paused on an open tool call. The latter covers approval
    // and slot-picker continuations: after the user answers, the run keeps
    // streaming server-side while the DB still shows the tool as
    // `approval-requested`/`input-available`, so on return the last message is
    // that assistant turn, not a user one. The GET reconnect returns 204 when
    // nothing is actually in flight (a genuinely-waiting approval), leaving the
    // interactive card untouched.
    const last = initialMessages.at(-1);
    if (last?.role === "user" || (last && messageHasOpenToolPause(last))) {
      resumedRef.current = resumeStream;
      resumeStream();
    }
  }, [autoResume, resumeStream, initialMessages]);

  useEffect(() => {
    if (!dataStream) {
      return;
    }
    if (dataStream.length === 0) {
      return;
    }

    const dataPart = dataStream[0];

    if (dataPart.type === "data-appendMessage") {
      const message = JSON.parse(dataPart.data);
      setMessages([...initialMessages, message]);
    }
  }, [dataStream, initialMessages, setMessages]);
}
