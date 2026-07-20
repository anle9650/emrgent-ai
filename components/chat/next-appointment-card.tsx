"use client";

import { DoorOpen, Mic } from "lucide-react";
import { useState } from "react";
import { useScribeMode } from "@/hooks/use-scribe-mode";
import { useScribeSession } from "@/hooks/use-scribe-session";
import { selectionFromAppointment } from "@/lib/ai/scribe";
import type { Appointment } from "@/lib/openemr/types";
import { cn } from "@/lib/utils";
import { formatStartTime, STATUS_TONE_CLASSES, statusOf } from "./appointments";

// The end-of-visit hand-off: once a visit is charted, the model surfaces the
// next roomed patient here so the clinician can start their scribe session in
// one click instead of walking back through the sidebar → picker flow. Clicking
// selects the patient and returns to the recording panel (the scribe session
// state lives at the layout level, so it survives the navigation). If a
// recording is already live, the click is refused — you finish one visit before
// starting the next. Teal `appointment` accent, matching the calendar taxonomy.
export function NextAppointmentCard({
  appointment,
}: {
  appointment: Appointment;
}) {
  const { select, indicatorState } = useScribeSession();
  const { returnToScribeSession } = useScribeMode();
  const [blocked, setBlocked] = useState(false);

  const status = statusOf(appointment);
  const { time, meridiem } = formatStartTime(appointment.pc_startTime);
  const patientName =
    [appointment.fname, appointment.lname].filter(Boolean).join(" ") ||
    "Patient";

  const start = () => {
    // A recording is already in progress — refuse rather than abandon it.
    if (indicatorState) {
      setBlocked(true);
      return;
    }
    select(selectionFromAppointment(appointment));
    returnToScribeSession();
  };

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="flex">
        {/* Teal accent bar — appointment taxonomy */}
        <div className="w-[3px] shrink-0 self-stretch bg-appointment/70" />

        <div className="flex min-w-0 flex-1 flex-col">
          <button
            className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors duration-150 hover:bg-appointment/5"
            onClick={start}
            type="button"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-appointment/10 text-appointment">
              <DoorOpen className="size-4" />
            </div>

            <div className="flex min-w-0 flex-col me-auto">
              <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
                Next patient
              </span>
              <span className="truncate font-display font-bold text-[15px] text-foreground tracking-[0.01em]">
                {patientName}
              </span>
              <span className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {time}
                <span className="ms-0.5 font-mono text-[9px] uppercase tracking-[0.06em]">
                  {meridiem}
                </span>
                {appointment.pc_title ? ` · ${appointment.pc_title}` : ""}
              </span>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span
                className={cn(
                  "rounded-[5px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]",
                  STATUS_TONE_CLASSES[status.tone]
                )}
              >
                {status.label}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-appointment px-2 py-1 font-mono text-[10px] text-white uppercase tracking-[0.08em]">
                <Mic className="size-3" />
                Start scribe
              </span>
            </div>
          </button>

          {blocked && (
            <div className="border-attention/30 border-t bg-attention/5 px-4 py-2 font-mono text-[10px] text-attention uppercase tracking-[0.08em]">
              Finish your current scribe session before starting a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
