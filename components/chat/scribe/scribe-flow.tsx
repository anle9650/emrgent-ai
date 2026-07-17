"use client";

import { format } from "date-fns";
import { LoaderIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useScribeSession } from "@/hooks/use-scribe-session";
import { buildScribeKickoffMessage } from "@/lib/ai/scribe";
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
  } = useScribeSession();

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
    if (segments.length === 0 || !segments.every((segment) => segment.text)) {
      return;
    }
    sentRef.current = true;
    const transcript = segments
      .map((segment) => segment.text)
      .join("\n\n")
      .trim();
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
              // Stamp the recording date and time so the note keeps the
              // real visit moment when reopened later.
              visitDate: format(new Date(), "yyyy-MM-dd"),
              visitTime: format(new Date(), "HH:mm"),
            }),
          },
        ],
      },
      // Per-call body field, spread into the chat request by
      // prepareSendMessagesRequest — marks the Chat row as a scribe session.
      { body: { kind: "scribe" } }
    );
    endSession();
  }, [
    recordingDone,
    segments,
    selection,
    sentRef,
    chatId,
    sendMessage,
    endSession,
  ]);

  const failedSegments = segments.filter((segment) => segment.failed);
  const noAudio = recordingDone && segments.length === 0;

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
          elapsedMs={recorder.elapsedMs}
          error={recorder.error}
          onCancel={reset}
          onFinish={recorder.stop}
          onPause={recorder.pause}
          onResume={recorder.resume}
          onStart={recorder.start}
          selection={selection}
          status={recorder.status}
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
          <LoaderIcon className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
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
