"use client";

import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { patientOverviewDocumentId } from "@/components/chat/patient-overview-artifact";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useArtifact } from "@/hooks/use-artifact";
import { readScribeChartState } from "@/lib/ai/scribe";

// Must match the SWR key the overview artifact fetches with
// (artifacts/patient-overview/client.tsx) so mutate() refreshes an open chart.
function overviewKey(uuid: string, pid: number) {
  return `/api/openemr/patient-overview?uuid=${encodeURIComponent(
    uuid
  )}&pid=${encodeURIComponent(String(pid))}`;
}

// When a scribe session charts a visit, refresh the patient's overview chart
// *if it's already open* so it reflects the new encounter/problems/meds. We no
// longer force it open — a ViewChartCard in the chat lets the user open it on
// demand. When the chart is closed there's nothing to refresh; SWR revalidates
// on the next manual open anyway.
export function useScribeChartAutoRefresh() {
  const { chatId, messages } = useActiveChat();
  const { artifact } = useArtifact();
  const { mutate } = useSWRConfig();

  // Encounter ids already refreshed for, so mutate fires once per newly-charted
  // encounter rather than on every streaming render. Reset when the chat
  // changes.
  const refreshed = useRef<Set<string>>(new Set());
  const chatRef = useRef(chatId);

  if (chatRef.current !== chatId) {
    chatRef.current = chatId;
    refreshed.current = new Set();
  }

  useEffect(() => {
    const state = readScribeChartState(messages);
    if (!state) {
      return;
    }

    // Only refresh a chart the user already has open for this patient.
    const isOpen =
      artifact.isVisible &&
      artifact.documentId === patientOverviewDocumentId(state.patient);
    if (!isOpen) {
      return;
    }

    const fresh = state.completedEncounterIds.filter(
      (id) => !refreshed.current.has(id)
    );
    if (fresh.length === 0) {
      return;
    }
    for (const id of fresh) {
      refreshed.current.add(id);
    }

    mutate(overviewKey(state.patient.uuid, state.patient.pid));
  }, [messages, artifact, mutate]);
}
