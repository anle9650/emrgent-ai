"use client";

import { useScribeMode } from "@/hooks/use-scribe-mode";
import { useScribeSession } from "@/hooks/use-scribe-session";
import { cn } from "@/lib/utils";
import { formatElapsed } from "./recording-panel";

const STATUS_LABEL = {
  recording: "Recording",
  paused: "Paused",
  transcribing: "Transcribing",
} as const;

// Floating pill shown anywhere in the app while a scribe session is live but
// its panel is off screen. Clicking it navigates back to the recording panel.
export function RecordingIndicator({
  hidden,
}: {
  /** True while the recording panel itself is on screen. */
  hidden: boolean;
}) {
  const { indicatorState } = useScribeSession();
  const { returnToScribeSession } = useScribeMode();

  if (!indicatorState || hidden) {
    return null;
  }
  const { patientName, status, elapsedMs } = indicatorState;

  return (
    <button
      aria-label={`Return to recording for ${patientName}`}
      className="-translate-x-1/2 absolute top-3 left-1/2 z-10 flex items-center gap-2 rounded-full border border-border/50 bg-card py-1.5 pr-4 pl-3 font-mono text-[10px] text-foreground uppercase tracking-[0.08em] shadow-(--shadow-float) transition-colors hover:bg-accent"
      onClick={returnToScribeSession}
      type="button"
    >
      <span
        className={cn(
          "size-2 rounded-full",
          status === "recording" &&
            "animate-pulse bg-negative motion-reduce:animate-none",
          status === "paused" && "bg-attention",
          status === "transcribing" && "bg-primary"
        )}
      />
      <span className="tabular-nums">
        {STATUS_LABEL[status]}
        {status !== "transcribing" && ` · ${formatElapsed(elapsedMs)}`}
        {` · ${patientName}`}
      </span>
    </button>
  );
}
