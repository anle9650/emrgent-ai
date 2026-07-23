"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { parseScribeKickoff, SCRIBE_SESSION_HEADER } from "@/lib/ai/scribe";
import type { ChatMessage } from "@/lib/types";

/** The scribe session's linked appointment, or null when this chat has no
 * scribe kickoff (or the session wasn't started from an appointment). Only the
 * calendar id is exposed — the ViewChartCard's Check Out action keys off it and
 * reads the appointment's current status live. */
export type ScribeAppointmentRefValue = { eid: string } | null;

const ScribeAppointmentContext = createContext<ScribeAppointmentRefValue>(null);

// Recovers the linked appointment id from the scribe kickoff message — the
// only durable record of the session (client session state is cleared once the
// kickoff is sent). Parses the first message carrying the kickoff header, so a
// cross-turn ViewChartCard can still reach it. Sibling to
// A2UIToolSourceProvider: both derive from the conversation's `messages`.
export function ScribeAppointmentProvider({
  messages,
  children,
}: {
  messages: ChatMessage[];
  children: ReactNode;
}) {
  const value = useMemo<ScribeAppointmentRefValue>(() => {
    for (const message of messages) {
      for (const part of message.parts ?? []) {
        if (part.type === "text" && part.text.includes(SCRIBE_SESSION_HEADER)) {
          const { appointmentEid } = parseScribeKickoff(part.text);
          return appointmentEid ? { eid: appointmentEid } : null;
        }
      }
    }
    return null;
  }, [messages]);

  return (
    <ScribeAppointmentContext.Provider value={value}>
      {children}
    </ScribeAppointmentContext.Provider>
  );
}

export function useScribeAppointment() {
  return useContext(ScribeAppointmentContext);
}
