"use client";

import { format } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { EcgIcon } from "@/components/ecg-icon";
import { Button } from "@/components/ui/button";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useScribeSession } from "@/hooks/use-scribe-session";
import {
  buildScribeKickoffMessage,
  type ScribePriorChartSections,
} from "@/lib/ai/scribe";
import { PatientSelect } from "./patient-select";
import { RecordingPanel } from "./recording-panel";

export function ScribeFlow() {
  const { chatId, sendMessage } = useActiveChat();
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

  // Once recording has finished and every segment has its transcript, build
  // the kickoff message and hand off to the normal chat flow — the same
  // pushState + sendMessage pattern MultimodalInput's submitForm uses.
  // This effect must live here, not in the provider: `chatId` is only the
  // fresh tentative new-chat id while ScribeFlow is mounted, so a send fired
  // while the user is viewing another chat would land in that chat.
  useEffect(() => {
    if (!(recordingDone && selection) || sentRef.current) {
      return;
    }
    // The demo shortcut supplies a canned transcript in place of recorded
    // segments; otherwise wait until every segment has been transcribed.
    if (
      !demoTranscript &&
      (segments.length === 0 || !segments.every((segment) => segment.text))
    ) {
      return;
    }
    sentRef.current = true;
    const transcript = (
      demoTranscript ?? segments.map((segment) => segment.text).join("\n\n")
    ).trim();
    // Stamp the recording date and time before any awaiting, so the note
    // keeps the real visit moment when reopened later.
    const visitDate = format(new Date(), "yyyy-MM-dd");
    const visitTime = format(new Date(), "HH:mm");
    const send = (priorChart: ScribePriorChartSections | null) => {
      window.history.pushState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage(
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: buildScribeKickoffMessage({
                ...selection,
                transcript,
                visitDate,
                visitTime,
                priorChart,
              }),
            },
          ],
        },
        // Per-call body field, spread into the chat request by
        // prepareSendMessagesRequest — marks the Chat row as a scribe session.
        { body: { kind: "scribe" } }
      );
      endSession();
    };
    // Prefetch the chart so the kickoff carries the prior-chart block and the
    // agent skips the context-read tool calls. Any failure degrades to a
    // kickoff without the block — scribePrompt's fallback covers it.
    fetch(
      `/api/openemr/patient-overview?uuid=${encodeURIComponent(selection.patient.uuid)}&pid=${encodeURIComponent(String(selection.patient.pid))}`,
      { signal: AbortSignal.timeout(20_000) }
    )
      .then((response) =>
        response.ok
          ? (response.json() as Promise<ScribePriorChartSections>)
          : null
      )
      .catch(() => null)
      .then(send);
  }, [
    recordingDone,
    segments,
    selection,
    sentRef,
    chatId,
    sendMessage,
    endSession,
    demoTranscript,
  ]);

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
