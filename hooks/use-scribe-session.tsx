"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEncounterRecorder } from "@/hooks/use-encounter-recorder";
import type { ScribeSelection } from "@/lib/ai/scribe";
import type { SplitEncounter } from "@/lib/ai/scribe-split";

export type ScribeStage = "select" | "record" | "transcribing" | "review-split";

export type ScribeSegment = {
  // The blob is held only until its transcript arrives (kept on failure so a
  // retry doesn't need re-recording); audio is never persisted anywhere.
  blob: Blob | null;
  text: string | null;
  failed: boolean;
};

export type ScribeIndicatorState = {
  patientName: string;
  status: "recording" | "paused" | "transcribing" | "review";
  elapsedMs: number;
};

/** The multi-encounter check that runs between transcription and the kickoff.
 * `transcript` is the whole recording; `encounters` are its verbatim slices —
 * exactly one when the recording holds a single visit, which is the ordinary
 * case and also every failure's answer. */
export type ScribeSplitState = {
  status: "pending" | "resolved";
  transcript: string;
  encounters: SplitEncounter[];
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
  /** True when the demo OpenEMR instance is active — enables the recording
   * panel's "Use demo recording" shortcut. */
  demoRecording: boolean;
  /** A canned transcript supplied by the demo shortcut, in place of recorded
   * audio; null on the normal recording path. */
  demoTranscript: string | null;
  /** Skip recording and hand off a canned transcript to the kickoff flow. */
  startDemoRecording: (transcript: string) => void;
  /** The multi-encounter check; null until the transcript is complete. The
   * kickoff waits on this resolving, so a recording that ran through two
   * rooms can't be charted to one patient. */
  splitState: ScribeSplitState | null;
  /** Collapse a detected split back to the whole transcript — the clinician
   * saying it was really one visit. */
  resolveSplitToSingle: () => void;
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
export function ScribeSessionProvider({
  children,
  demoRecording = false,
}: {
  children: ReactNode;
  demoRecording?: boolean;
}) {
  const [stage, setStage] = useState<ScribeStage>("select");
  const [selection, setSelection] = useState<ScribeSelection | null>(null);
  const [segments, setSegments] = useState<ScribeSegment[]>([]);
  const [recordingDone, setRecordingDone] = useState(false);
  const [demoTranscript, setDemoTranscript] = useState<string | null>(null);
  const [splitState, setSplitState] = useState<ScribeSplitState | null>(null);
  const sentRef = useRef(false);
  const splitRequestedRef = useRef(false);

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

  // Demo shortcut: skip audio capture entirely and hand a canned transcript to
  // the kickoff flow. Marks the recording done and moves to "transcribing" so
  // ScribeFlow's send effect fires (it reads demoTranscript in place of
  // segments) and shows the same brief loading state as the real path.
  const startDemoRecording = useCallback((transcript: string) => {
    setDemoTranscript(transcript);
    setRecordingDone(true);
    setStage("transcribing");
  }, []);

  // Between transcription and the kickoff: check whether the recording holds
  // more than one visit. Runs here rather than in ScribeFlow so it proceeds
  // even while the clinician is looking at another chat — ScribeFlow only has
  // to be mounted for the *send*, which is gated on this resolving.
  //
  // Any failure resolves to a single whole-transcript encounter: detection is
  // an extra safeguard and must never stand between a visit and its chart.
  useEffect(() => {
    if (splitRequestedRef.current || !(recordingDone && selection)) {
      return;
    }
    if (
      !demoTranscript &&
      (segments.length === 0 || !segments.every((segment) => segment.text))
    ) {
      return;
    }
    splitRequestedRef.current = true;

    const transcript = (
      demoTranscript ?? segments.map((segment) => segment.text).join("\n\n")
    ).trim();
    const resolveSingle = () =>
      setSplitState({
        status: "resolved",
        transcript,
        encounters: [
          { text: transcript, patientName: null, chiefComplaint: "" },
        ],
      });

    setSplitState({ status: "pending", transcript, encounters: [] });
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/scribe/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        currentPatientName: selection.patient.name,
      }),
      signal: AbortSignal.timeout(20_000),
    })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ encounters: SplitEncounter[] }>)
          : null
      )
      .catch(() => null)
      .then((data) => {
        const encounters = data?.encounters ?? [];
        if (encounters.length < 2) {
          resolveSingle();
          return;
        }
        setSplitState({ status: "resolved", transcript, encounters });
        setStage("review-split");
      });
  }, [recordingDone, selection, segments, demoTranscript]);

  const resolveSplitToSingle = useCallback(() => {
    setSplitState((previous) =>
      previous
        ? {
            status: "resolved",
            transcript: previous.transcript,
            encounters: [
              {
                text: previous.transcript,
                patientName: null,
                chiefComplaint: "",
              },
            ],
          }
        : previous
    );
    setStage("transcribing");
  }, []);

  const clearSession = useCallback(() => {
    setSelection(null);
    setSegments([]);
    setRecordingDone(false);
    setDemoTranscript(null);
    setSplitState(null);
    sentRef.current = false;
    splitRequestedRef.current = false;
    setStage("select");
    recorder.resetElapsed();
  }, [recorder.resetElapsed]);

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
    // Kept through transcription and split review: the kickoff send is gated
    // on ScribeFlow being mounted, so the indicator is the way back to an
    // un-charted session — and a split awaiting review is exactly a session
    // the clinician must come back to.
    if (stage === "transcribing" || stage === "review-split") {
      return {
        patientName: name,
        status: stage === "review-split" ? "review" : "transcribing",
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
      demoRecording,
      demoTranscript,
      startDemoRecording,
      splitState,
      resolveSplitToSingle,
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
      demoRecording,
      demoTranscript,
      startDemoRecording,
      splitState,
      resolveSplitToSingle,
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
