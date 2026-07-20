"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Connects sequential agent-loop steps (as delimited by the AI SDK's
// step-start parts) into a vertical timeline — a circle per step, joined by
// a continuous line. Generic: works for any multi-step tool chain, not just
// the scribe protocol. `settled` drives a pulsing hollow ring while a step's
// tool call(s) are still mid-flight or awaiting approval, filling solid once
// resolved.
export type ProtocolTimelineStep = {
  id: string;
  label: string;
  settled: boolean;
  content: ReactNode;
};

export function ProtocolTimeline({ steps }: { steps: ProtocolTimelineStep[] }) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-0" data-testid="protocol-timeline">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <div className="flex gap-3" key={step.id}>
            <div className="flex w-4 shrink-0 flex-col items-center">
              <span
                className={cn(
                  "mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-background",
                  step.settled
                    ? "bg-primary ring-primary/30"
                    : "animate-pulse bg-transparent ring-primary/50"
                )}
              />
              {!isLast && <span className="my-1 w-px flex-1 bg-border" />}
            </div>
            <div className={cn("min-w-0 flex-1", isLast ? "pb-0" : "pb-3")}>
              {step.label && (
                <div className="mb-1 font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
                  {step.label}
                </div>
              )}
              {step.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
