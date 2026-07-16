"use client";

import {
  CircleStopIcon,
  FolderOpenIcon,
  LoaderIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import { type MouseEvent, useState } from "react";
import {
  patientOverviewArtifact,
  toSparsePatientSummary,
} from "@/components/chat/patient-overview-artifact";
import { Button } from "@/components/ui/button";
import { useArtifact } from "@/hooks/use-artifact";
import type { RecorderStatus } from "@/hooks/use-encounter-recorder";
import type { ScribeSelection } from "@/lib/ai/scribe";
import { cn } from "@/lib/utils";

function formatElapsed(elapsedMs: number) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

export function RecordingPanel({
  selection,
  status,
  elapsedMs,
  error,
  onStart,
  onPause,
  onResume,
  onFinish,
  onCancel,
}: {
  selection: ScribeSelection;
  status: RecorderStatus;
  elapsedMs: number;
  error: string | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const { patient, appointment } = selection;
  const { setArtifact } = useArtifact();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const recording = status === "recording";
  const paused = status === "paused";
  const active = recording || paused;

  // Cancelling an active recording discards audio that exists nowhere else —
  // confirm first. An idle cancel has nothing to lose, so it stays instant.
  const handleCancel = () => {
    if (active) {
      setConfirmingCancel(true);
    } else {
      onCancel();
    }
  };

  const openChart = (event: MouseEvent<HTMLButtonElement>) => {
    setArtifact(
      patientOverviewArtifact(
        toSparsePatientSummary(patient),
        event.currentTarget.getBoundingClientRect()
      )
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-8 px-4 py-8">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.12em]">
          Scribe session
        </span>
        <h2 className="font-display font-bold text-[22px] text-foreground tracking-[0.06em]">
          {patient.name}
        </h2>
        {appointment && (
          <p className="text-[13px] text-muted-foreground">
            {appointment.pc_title || "Appointment"} · {appointment.pc_eventDate}
          </p>
        )}
        <Button
          aria-label={`Open chart overview for ${patient.name || "patient"}`}
          className="mt-1 gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em]"
          onClick={openChart}
          size="sm"
          variant="outline"
        >
          <FolderOpenIcon className="size-3" />
          View chart
        </Button>
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border/50 bg-card px-5 py-8 shadow-(--shadow-card) sm:px-10">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "size-2.5 rounded-full",
              recording &&
                "animate-pulse bg-negative motion-reduce:animate-none",
              paused && "bg-attention",
              !active && "bg-muted-foreground/30"
            )}
          />
          <span className="font-mono text-[28px] text-foreground tabular-nums tracking-[0.04em]">
            {formatElapsed(elapsedMs)}
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.12em]">
          {status === "requesting" && "Requesting microphone…"}
          {recording && "Recording encounter"}
          {paused && "Paused"}
          {status === "idle" && "Ready to record"}
        </span>

        {confirmingCancel ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="w-full text-center text-[13px] text-muted-foreground sm:w-auto">
              Discard this recording?
            </span>
            <Button
              className="gap-1.5 text-negative hover:text-negative"
              onClick={() => {
                setConfirmingCancel(false);
                onCancel();
              }}
              variant="outline"
            >
              Discard
            </Button>
            <Button onClick={() => setConfirmingCancel(false)} variant="ghost">
              Keep recording
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {(status === "idle" || status === "requesting") && (
              <Button
                className="gap-1.5"
                disabled={status === "requesting"}
                onClick={onStart}
              >
                {status === "requesting" ? (
                  <LoaderIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <MicIcon className="size-3.5" />
                )}
                Start recording
              </Button>
            )}
            {recording && (
              <Button className="gap-1.5" onClick={onPause} variant="outline">
                <PauseIcon className="size-3.5" />
                Pause
              </Button>
            )}
            {paused && (
              <Button className="gap-1.5" onClick={onResume} variant="outline">
                <PlayIcon className="size-3.5" />
                Resume
              </Button>
            )}
            {active && (
              <Button className="gap-1.5" onClick={onFinish}>
                <CircleStopIcon className="size-3.5" />
                Finish
              </Button>
            )}
            <Button className="gap-1.5" onClick={handleCancel} variant="ghost">
              <XIcon className="size-3.5" />
              Cancel
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p className="max-w-md text-center text-[13px] text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
