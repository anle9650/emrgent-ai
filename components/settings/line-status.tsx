import { EcgIcon } from "@/components/ecg-icon";
import { cn } from "@/lib/utils";

export type LineState = "live" | "dropped" | "off";

/**
 * The connection panel's signature element: the brand ECG mark used as a
 * line-status lamp. The page asks exactly one question — is there a live line
 * to the record system? — so the answer is the loudest thing on it, and it's
 * stated in the app's own vocabulary rather than as a generic status pill.
 *
 * The traced variant already respects prefers-reduced-motion (see EcgIcon).
 */
export function LineStatus({ state }: { state: LineState }) {
  const { label, tone } = LINE_PRESENTATION[state];

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-full border px-3 py-1.5",
        state === "live" && "border-primary/30 bg-primary/8",
        state === "dropped" && "border-attention/30 bg-attention/8",
        state === "off" && "border-border/60 bg-muted/40"
      )}
    >
      <EcgIcon
        animated={state === "live"}
        className={cn("h-[11px] w-[27px]", tone)}
        flat={state === "off"}
      />
      <span
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.14em]",
          tone
        )}
      >
        {label}
      </span>
    </div>
  );
}

const LINE_PRESENTATION: Record<LineState, { label: string; tone: string }> = {
  live: { label: "Connected", tone: "text-primary" },
  dropped: { label: "Connection lost", tone: "text-attention" },
  off: { label: "Disconnected", tone: "text-muted-foreground/70" },
};
