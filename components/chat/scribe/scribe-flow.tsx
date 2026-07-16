"use client";

import { format } from "date-fns";
import { LoaderIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useEncounterRecorder } from "@/hooks/use-encounter-recorder";
import {
  buildScribeKickoffMessage,
  type ScribeSelection,
} from "@/lib/ai/scribe";
import { PatientSelect } from "./patient-select";
import { RecordingPanel } from "./recording-panel";

type Stage = "select" | "record" | "transcribing";

type Segment = {
  // The blob is held only until its transcript arrives (kept on failure so a
  // retry doesn't need re-recording); audio is never persisted anywhere.
  blob: Blob | null;
  text: string | null;
  failed: boolean;
};

async function postSegment(blob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("audio", blob, "segment.webm");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/transcribe`,
    { method: "POST", body: formData }
  );
  if (!response.ok) {
    throw new Error("transcription_failed");
  }
  const { text } = (await response.json()) as { text: string };
  return text;
}

export function ScribeFlow() {
  const { chatId, sendMessage } = useActiveChat();
  const [stage, setStage] = useState<Stage>("select");
  const [selection, setSelection] = useState<ScribeSelection | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [recordingDone, setRecordingDone] = useState(false);
  const sentRef = useRef(false);

  const transcribeSegment = useCallback((blob: Blob, index: number) => {
    setSegments((prev) => {
      const next = [...prev];
      next[index] = { blob, text: null, failed: false };
      return next;
    });
    postSegment(blob)
      .then((text) => {
        setSegments((prev) => {
          const next = [...prev];
          next[index] = { blob: null, text, failed: false };
          return next;
        });
      })
      .catch(() => {
        setSegments((prev) => {
          const next = [...prev];
          next[index] = { blob, text: null, failed: true };
          return next;
        });
      });
  }, []);

  const recorder = useEncounterRecorder({
    onSegment: transcribeSegment,
    onStopped: () => {
      setRecordingDone(true);
      setStage("transcribing");
    },
  });

  // Once recording has finished and every segment has its transcript, build
  // the kickoff message and hand off to the normal chat flow — the same
  // pushState + sendMessage pattern MultimodalInput's submitForm uses.
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
              // Stamp the recording date so the note keeps the real visit
              // date when reopened later.
              visitDate: format(new Date(), "yyyy-MM-dd"),
            }),
          },
        ],
      },
      // Per-call body field, spread into the chat request by
      // prepareSendMessagesRequest — marks the Chat row as a scribe session.
      { body: { kind: "scribe" } }
    );
  }, [recordingDone, segments, selection, chatId, sendMessage]);

  const failedSegments = segments.filter((segment) => segment.failed);
  const noAudio = recordingDone && segments.length === 0;

  const reset = () => {
    recorder.cancel();
    setSelection(null);
    setSegments([]);
    setRecordingDone(false);
    sentRef.current = false;
    setStage("select");
  };

  if (stage === "select" || !selection) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PatientSelect
          onSelect={(selected) => {
            setSelection(selected);
            setStage("record");
          }}
        />
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
                      transcribeSegment(segment.blob, index);
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
