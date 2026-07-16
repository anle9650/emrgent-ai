"use client";

import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import {
  patientOverviewArtifact,
  toSparsePatientSummary,
} from "@/components/chat/patient-overview-artifact";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useArtifact } from "@/hooks/use-artifact";
import { readScribeChartState } from "@/lib/ai/scribe";

// No originating click, so open from a zero-rect.
const CLOSED_BOX = { top: 0, left: 0, width: 0, height: 0 };

// Must match the SWR key the overview artifact fetches with
// (artifacts/patient-overview/client.tsx) so mutate() refreshes an open chart.
function overviewKey(uuid: string, pid: number) {
  return `/api/openemr/patient-overview?uuid=${encodeURIComponent(
    uuid
  )}&pid=${encodeURIComponent(String(pid))}`;
}

// When a scribe session finishes charting a visit, open the patient's overview
// chart (or refresh it if already open). "Finished" is detected without
// assuming createEncounter is the last call: the turn must be fully settled
// (status ready, no pending tools) AND an encounter must have been created.
export function useScribeChartAutoOpen() {
  const { chatId, messages, status } = useActiveChat();
  const { artifact, setArtifact } = useArtifact();
  const { mutate } = useSWRConfig();

  // Per-chat state: encounter ids already handled. `seeded` snapshots the
  // encounters present when the chat first loads (e.g. reopening a finished
  // scribe chat) as already-handled, so only encounters charted live from
  // here on trigger the auto-open.
  const observed = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const chatRef = useRef(chatId);

  if (chatRef.current !== chatId) {
    chatRef.current = chatId;
    observed.current = new Set();
    seeded.current = false;
  }

  useEffect(() => {
    const state = readScribeChartState(messages);
    if (!state) {
      return;
    }

    if (!seeded.current) {
      for (const id of state.completedEncounterIds) {
        observed.current.add(id);
      }
      seeded.current = true;
      return;
    }

    const fresh = state.completedEncounterIds.filter(
      (id) => !observed.current.has(id)
    );
    // Wait for the turn to fully settle (no tool mid-loop or awaiting
    // approval) so we don't fire between the write and the closing summary.
    if (status !== "ready" || state.hasPendingTool || fresh.length === 0) {
      return;
    }
    for (const id of fresh) {
      observed.current.add(id);
    }

    const overview = patientOverviewArtifact(
      toSparsePatientSummary(state.patient),
      CLOSED_BOX
    );
    const alreadyOpen =
      artifact.isVisible && artifact.documentId === overview.documentId;
    if (!alreadyOpen) {
      setArtifact(overview);
    }
    // The encounter (and possibly problems/meds) just changed — refetch so an
    // already-open chart reflects the writes.
    mutate(overviewKey(state.patient.uuid, state.patient.pid));
  }, [messages, status, artifact, setArtifact, mutate]);
}
