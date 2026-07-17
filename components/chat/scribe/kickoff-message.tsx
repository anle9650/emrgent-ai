"use client";

import { format } from "date-fns";
import { CalendarDays, ChevronDownIcon, ScrollText } from "lucide-react";
import { useState } from "react";
import { parseScribeKickoff } from "@/lib/ai/scribe";
import { cn, parseDateSafe } from "@/lib/utils";

// A scribe kickoff message is internal prompting (patient ref + instruction +
// full transcript) that seeds the chat. Rather than surface that raw text, we
// present it as a filed "encounter note" banner: a scroll badge, the patient
// name and visit date, and the transcript tucked behind a toggle. The visit
// date is "now" — the banner is viewed the same day the encounter is recorded.
export function ScribeKickoffMessage({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { patientName, visitDate, appointmentTitle, transcript } =
    parseScribeKickoff(text);
  // Stamped at recording time; fall back to today only for older messages
  // saved before the date was baked in.
  const visitDateLabel = format(
    (visitDate ? parseDateSafe(visitDate) : null) ?? new Date(),
    "MMM d, yyyy"
  );

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/50 bg-card text-left shadow-(--shadow-card)">
      <div className="flex">
        {/* Gold accent bar — scribe/vitals carry the primary tone */}
        <div className="w-[3px] shrink-0 self-stretch bg-primary/70" />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
              <ScrollText className="size-4" />
            </div>

            <div className="flex min-w-0 flex-col me-auto">
              <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
                Scribe session
              </span>
              <span className="truncate font-display font-bold text-[15px] text-foreground tracking-[0.01em]">
                {patientName || "Encounter"}
              </span>
            </div>

            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground/70">
              <CalendarDays className="size-[13px] shrink-0" />
              <span className="tabular-nums">{visitDateLabel}</span>
              {appointmentTitle && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="truncate">{appointmentTitle}</span>
                </>
              )}
            </span>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                aria-expanded={open}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/50 px-2 py-1 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-muted/40 hover:text-foreground"
                onClick={() => setOpen((prev) => !prev)}
                type="button"
              >
                <ChevronDownIcon
                  className={cn(
                    "size-3 transition-transform duration-150",
                    open && "rotate-180"
                  )}
                />
                Encounter transcript
              </button>
            </div>
          </div>

          {open && (
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap border-border/40 border-t px-4 py-3 text-[13px] text-muted-foreground leading-[1.6]">
              {transcript}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
