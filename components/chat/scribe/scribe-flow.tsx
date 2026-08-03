"use client";

import { format } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/chat/toast";
import { EcgIcon } from "@/components/ecg-icon";
import { Button } from "@/components/ui/button";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useScribeSession } from "@/hooks/use-scribe-session";
import {
  buildScribeKickoffMessage,
  type ScribePriorChartSections,
} from "@/lib/ai/scribe";
import type { ScribeSendUnit } from "@/lib/ai/scribe-split";
import { generateUUID } from "@/lib/utils";
import { PatientSelect } from "./patient-select";
import { RecordingPanel } from "./recording-panel";
import { SplitReview } from "./split-review";

export function ScribeFlow() {
  const { chatId, sendMessage, startBackgroundScribeChat } = useActiveChat();
  const {
    stage,
    selection,
    segments,
    recordingDone,
    sentRef,
    recorder,
    select,
    retrySegment,
    reset,
    endSession,
    demoRecording,
    demoTranscript,
    startDemoRecording,
    splitState,
    resolveSplitToSingle,
  } = useScribeSession();
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Demo shortcut: fetch this patient's canned transcript and hand it to the
  // session, which drives the same kickoff send effect below.
  const handleUseDemoRecording = useCallback(async () => {
    if (!selection) {
      return;
    }
    setDemoError(null);
    setDemoLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/openemr/demo-transcript?uuid=${encodeURIComponent(
          selection.patient.uuid
        )}`
      );
      if (!response.ok) {
        throw new Error("demo_transcript_failed");
      }
      const { transcript } = (await response.json()) as { transcript: string };
      startDemoRecording(transcript);
    } catch {
      setDemoError("Could not load the demo recording. Please try again.");
      setDemoLoading(false);
    }
  }, [selection, startDemoRecording]);

  // Hand one or more encounters off to the chat flow. Unit 0 goes to the
  // foreground chat via the same pushState + sendMessage pattern
  // MultimodalInput's submitForm uses; any further units (a split recording
  // that ran through more than one room) each get their own detached chat,
  // streaming in the background so no session waits on another.
  //
  // This must live here, not in the provider: `chatId` is only the fresh
  // tentative new-chat id while ScribeFlow is mounted, so a send fired while
  // the user is viewing another chat would land in that chat.
  const sendSessions = useCallback(
    async (units: ScribeSendUnit[]) => {
      if (units.length === 0 || sentRef.current) {
        return;
      }
      sentRef.current = true;

      // Stamp the recording date and time before any awaiting, so the notes
      // keep the real visit moment when reopened later.
      const visitDate = format(new Date(), "yyyy-MM-dd");
      const visitTime = format(new Date(), "HH:mm");

      // Prefetch each chart so the kickoffs carry the prior-chart block and the
      // agent skips the context-read tool calls. Any failure degrades to a
      // kickoff without the block — scribePrompt's fallback covers it.
      const priorCharts = await Promise.all(
        units.map((unit) =>
          fetch(
            `/api/openemr/patient-overview?uuid=${encodeURIComponent(unit.selection.patient.uuid)}&pid=${encodeURIComponent(String(unit.selection.patient.pid))}`,
            { signal: AbortSignal.timeout(20_000) }
          )
            .then((response) =>
              response.ok
                ? (response.json() as Promise<ScribePriorChartSections>)
                : null
            )
            .catch(() => null)
        )
      );

      const kickoffFor = (unit: ScribeSendUnit, index: number) =>
        buildScribeKickoffMessage({
          ...unit.selection,
          transcript: unit.transcript,
          visitDate,
          visitTime,
          priorChart: priorCharts[index],
        });

      window.history.pushState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage(
        {
          role: "user",
          parts: [{ type: "text", text: kickoffFor(units[0], 0) }],
        },
        // Per-call body field, spread into the chat request by
        // prepareSendMessagesRequest — marks the Chat row as a scribe session.
        { body: { kind: "scribe" } }
      );

      const extras = units.slice(1);
      extras.forEach((unit, offset) => {
        startBackgroundScribeChat(generateUUID(), kickoffFor(unit, offset + 1));
      });

      // One toast for the whole batch, not one per session. The sidebar is the
      // durable channel — each session appears there with its own title and
      // lights its pending dot when it reaches its first approval.
      if (extras.length === 1) {
        toast({
          type: "success",
          description: `Second visit started — ${extras[0].selection.patient.name} is charting in its own session.`,
        });
      } else if (extras.length > 1) {
        toast({
          type: "success",
          description: `${extras.length} more visits started — each is charting in its own session.`,
        });
      }

      endSession();
    },
    [chatId, sendMessage, endSession, sentRef, startBackgroundScribeChat]
  );

  // The ordinary path: one encounter, sent as soon as the split check clears
  // it. Gating on the verdict rather than on transcription is load-bearing —
  // the transcript is complete before the check answers, so sending on that
  // alone would race the review and chart the whole recording to one patient.
  useEffect(() => {
    if (
      sentRef.current ||
      splitState?.status !== "resolved" ||
      splitState.encounters.length !== 1 ||
      !selection
    ) {
      return;
    }
    sendSessions([{ selection, transcript: splitState.encounters[0].text }]);
  }, [splitState, selection, sentRef, sendSessions]);

  const failedSegments = segments.filter((segment) => segment.failed);
  // The demo path has no recorded audio by design — don't treat it as a
  // capture failure.
  const noAudio = recordingDone && segments.length === 0 && !demoTranscript;

  if (stage === "select" || !selection) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PatientSelect onSelect={select} />
      </div>
    );
  }

  if (stage === "record") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <RecordingPanel
          demoAvailable={demoRecording}
          demoLoading={demoLoading}
          elapsedMs={recorder.elapsedMs}
          error={recorder.error ?? demoError}
          onCancel={reset}
          onFinish={recorder.stop}
          onPause={recorder.pause}
          onResume={recorder.resume}
          onStart={recorder.start}
          onUseDemoRecording={handleUseDemoRecording}
          selection={selection}
          status={recorder.status}
          stream={recorder.stream}
        />
      </div>
    );
  }

  if (stage === "review-split" && splitState) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SplitReview
          currentSelection={selection}
          encounters={splitState.encounters}
          onChart={sendSessions}
          onNotSplit={resolveSplitToSingle}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4">
      {failedSegments.length > 0 || noAudio ? (
        <>
          <p className="max-w-md text-center text-[13px] text-negative">
            {noAudio
              ? "No audio was captured. Start the session again."
              : "Transcription failed for part of the recording."}
          </p>
          <div className="flex items-center gap-2">
            {!noAudio && (
              <Button
                onClick={() => {
                  segments.forEach((segment, index) => {
                    if (segment.failed && segment.blob) {
                      retrySegment(segment.blob, index);
                    }
                  });
                }}
              >
                Retry transcription
              </Button>
            )}
            <Button onClick={reset} variant="ghost">
              Start over
            </Button>
          </div>
        </>
      ) : (
        <>
          <EcgIcon animated className="h-[18px] w-11 text-primary" />
          <div className="flex flex-col items-center gap-1">
            <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.12em]">
              Transcribing encounter
            </span>
            <span className="text-[13px] text-muted-foreground">
              {segments.filter((segment) => segment.text).length} of{" "}
              {segments.length || 1} segment
              {segments.length === 1 ? "" : "s"} done
            </span>
          </div>
        </>
      )}
    </div>
  );
}
