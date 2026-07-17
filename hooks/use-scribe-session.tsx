"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEncounterRecorder } from "@/hooks/use-encounter-recorder";
import type { ScribeSelection } from "@/lib/ai/scribe";

export type ScribeStage = "select" | "record" | "transcribing";

export type ScribeSegment = {
  // The blob is held only until its transcript arrives (kept on failure so a
  // retry doesn't need re-recording); audio is never persisted anywhere.
  blob: Blob | null;
  text: string | null;
  failed: boolean;
};

export type ScribeIndicatorState = {
  patientName: string;
  status: "recording" | "paused" | "transcribing";
  elapsedMs: number;
};

type ScribeSessionContextValue = {
  stage: ScribeStage;
  selection: ScribeSelection | null;
  segments: ScribeSegment[];
  recordingDone: boolean;
  /** Kickoff-sent guard — lives here so ScribeFlow remounts can't double-send. */
  sentRef: { current: boolean };
  recorder: ReturnType<typeof useEncounterRecorder>;
  select: (selection: ScribeSelection) => void;
  retrySegment: (blob: Blob, index: number) => void;
  /** Discard everything (including an active recording) and return to the picker. */
  reset: () => void;
  /** Clear the session after the kickoff message has been sent. */
  endSession: () => void;
  /** Non-null while a session should surface the global floating indicator. */
  indicatorState: ScribeIndicatorState | null;
};

const ScribeSessionContext = createContext<ScribeSessionContextValue | null>(
  null
);

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

// Owns the entire scribe session — selection, recorder, transcript segments —
// at the layout level, so recording survives navigation away from the scribe
// panel (ScribeFlow renders only on the new-session page and unmounts freely).
export function ScribeSessionProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<ScribeStage>("select");
  const [selection, setSelection] = useState<ScribeSelection | null>(null);
  const [segments, setSegments] = useState<ScribeSegment[]>([]);
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

  const select = useCallback((selected: ScribeSelection) => {
    setSelection(selected);
    setStage("record");
  }, []);

  const clearSession = useCallback(() => {
    setSelection(null);
    setSegments([]);
    setRecordingDone(false);
    sentRef.current = false;
    setStage("select");
  }, []);

  const reset = useCallback(() => {
    recorder.cancel();
    clearSession();
  }, [recorder.cancel, clearSession]);

  const indicatorState = useMemo<ScribeIndicatorState | null>(() => {
    if (!selection) {
      return null;
    }
    const name = selection.patient.name || "patient";
    if (recorder.status === "recording" || recorder.status === "paused") {
      return {
        patientName: name,
        status: recorder.status,
        elapsedMs: recorder.elapsedMs,
      };
    }
    // Kept through transcription: the kickoff send is gated on ScribeFlow
    // being mounted, so the indicator is the way back to complete it.
    if (stage === "transcribing") {
      return {
        patientName: name,
        status: "transcribing",
        elapsedMs: recorder.elapsedMs,
      };
    }
    return null;
  }, [selection, recorder.status, recorder.elapsedMs, stage]);

  const value = useMemo<ScribeSessionContextValue>(
    () => ({
      stage,
      selection,
      segments,
      recordingDone,
      sentRef,
      recorder,
      select,
      retrySegment: transcribeSegment,
      reset,
      endSession: clearSession,
      indicatorState,
    }),
    [
      stage,
      selection,
      segments,
      recordingDone,
      recorder,
      select,
      transcribeSegment,
      reset,
      clearSession,
      indicatorState,
    ]
  );

  return (
    <ScribeSessionContext.Provider value={value}>
      {children}
    </ScribeSessionContext.Provider>
  );
}

export function useScribeSession() {
  const context = useContext(ScribeSessionContext);
  if (!context) {
    throw new Error(
      "useScribeSession must be used within ScribeSessionProvider"
    );
  }
  return context;
}
