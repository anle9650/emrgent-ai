"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { ChatMessage } from "@/lib/types";

// Any message part carrying a toolCallId (i.e. tool parts).
export type ToolSourcePart = Extract<
  ChatMessage["parts"][number],
  { toolCallId: string }
>;

const A2UIToolSourceContext = createContext<
  ReadonlyMap<string, ToolSourcePart>
>(new Map());

// Indexes every tool part in the conversation by toolCallId so A2UI domain
// cards can resolve `sourceToolCallId` references — including cross-message
// ones ("show those as a table" in a follow-up turn).
export function A2UIToolSourceProvider({
  messages,
  children,
}: {
  messages: ChatMessage[];
  children: ReactNode;
}) {
  const sources = useMemo(() => {
    const map = new Map<string, ToolSourcePart>();
    for (const message of messages) {
      for (const part of message.parts ?? []) {
        if ("toolCallId" in part) {
          map.set(part.toolCallId, part as ToolSourcePart);
        }
      }
    }
    return map;
  }, [messages]);

  return (
    <A2UIToolSourceContext.Provider value={sources}>
      {children}
    </A2UIToolSourceContext.Provider>
  );
}

export function useA2UIToolSources() {
  return useContext(A2UIToolSourceContext);
}
