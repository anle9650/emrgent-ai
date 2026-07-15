"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus = "idle" | "requesting" | "recording" | "paused";

// Rotating the recorder (stop + recreate on the same stream) every 10 minutes
// yields standalone blobs with container headers — a mid-stream `timeslice`
// chunk of webm is not independently decodable. At 32 kbps opus a 10-minute
// segment is ~2.4 MB, safely under the Vercel 4.5 MB request-body limit and
// Whisper's 25 MB file cap.
const SEGMENT_MS = 10 * 60 * 1000;
const MAX_RECORDING_MS = 2 * 60 * 60 * 1000;
const AUDIO_BITS_PER_SECOND = 32_000;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4", // Safari
];

export function pickRecorderMimeType(
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
): string | undefined {
  return MIME_CANDIDATES.find((type) => isTypeSupported(type));
}

export function useEncounterRecorder({
  onSegment,
  onStopped,
}: {
  /** Called with each completed standalone audio segment, in order. */
  onSegment: (blob: Blob, index: number) => void;
  /** Called after `stop()` (or the max-duration auto-stop) has emitted the
   * final segment and released the microphone. */
  onStopped?: () => void;
}) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const segmentIndexRef = useRef(0);
  const mimeTypeRef = useRef<string | undefined>(undefined);
  // "rotate" recreates the recorder on the same stream; "stop" / "cancel" end
  // the session. Read by onstop to decide what to do with the buffered chunks.
  const stopReasonRef = useRef<"rotate" | "stop" | "cancel">("stop");

  const onSegmentRef = useRef(onSegment);
  onSegmentRef.current = onSegment;
  const onStoppedRef = useRef(onStopped);
  onStoppedRef.current = onStopped;

  const statusRef = useRef(status);
  statusRef.current = status;

  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (rotateTimerRef.current) {
      clearTimeout(rotateTimerRef.current);
      rotateTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }, []);

  const startRecorderOnStream = useCallback(
    (stream: MediaStream) => {
      const recorder = new MediaRecorder(stream, {
        mimeType: mimeTypeRef.current,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const reason = stopReasonRef.current;
        if (reason !== "cancel" && chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, {
            type: mimeTypeRef.current ?? "audio/webm",
          });
          chunksRef.current = [];
          onSegmentRef.current(blob, segmentIndexRef.current);
          segmentIndexRef.current += 1;
        }
        if (reason === "rotate" && streamRef.current) {
          startRecorderOnStream(streamRef.current);
        } else {
          recorderRef.current = null;
          releaseStream();
          if (reason === "stop") {
            onStoppedRef.current?.();
          }
        }
      };
      recorderRef.current = recorder;
      recorder.start();
    },
    [releaseStream]
  );

  const scheduleRotation = useCallback(() => {
    rotateTimerRef.current = setTimeout(() => {
      if (recorderRef.current?.state === "recording") {
        stopReasonRef.current = "rotate";
        recorderRef.current.stop();
      }
      scheduleRotation();
    }, SEGMENT_MS);
  }, []);

  const stop = useCallback(() => {
    if (!recorderRef.current || statusRef.current === "idle") {
      return;
    }
    clearTimers();
    setStatus("idle");
    stopReasonRef.current = "stop";
    if (recorderRef.current.state === "paused") {
      recorderRef.current.resume();
    }
    recorderRef.current.stop();
  }, [clearTimers]);

  const cancel = useCallback(() => {
    clearTimers();
    setStatus("idle");
    setElapsedMs(0);
    elapsedRef.current = 0;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      stopReasonRef.current = "cancel";
      recorderRef.current.stop();
    } else {
      releaseStream();
    }
  }, [clearTimers, releaseStream]);

  const start = useCallback(async () => {
    if (statusRef.current !== "idle") {
      return;
    }
    setError(null);
    setStatus("requesting");
    setElapsedMs(0);
    elapsedRef.current = 0;
    segmentIndexRef.current = 0;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      setStatus("idle");
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was denied. Allow microphone access in your browser and try again."
          : "Could not access a microphone."
      );
      return;
    }

    streamRef.current = stream;
    mimeTypeRef.current = pickRecorderMimeType();
    startRecorderOnStream(stream);
    setStatus("recording");

    tickTimerRef.current = setInterval(() => {
      if (statusRef.current !== "recording") {
        return;
      }
      elapsedRef.current += 1000;
      setElapsedMs(elapsedRef.current);
      if (elapsedRef.current >= MAX_RECORDING_MS) {
        stop();
      }
    }, 1000);
    scheduleRotation();
  }, [scheduleRotation, startRecorderOnStream, stop]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      setStatus("paused");
    }
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      setStatus("recording");
    }
  }, []);

  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => () => cancelRef.current(), []);

  return { status, elapsedMs, error, start, pause, resume, stop, cancel };
}
