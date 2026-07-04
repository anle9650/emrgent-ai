"use client";

import { format, parseISO } from "date-fns";
import { CalendarClock, ClipboardPen, ShieldCheck, UserRound } from "lucide-react";
import type { SoapNote } from "@/lib/openemr/types";
import { cn } from "@/lib/utils";

function parseNoteDate(date: string) {
  try {
    const parsed = parseISO(date);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

const SECTIONS = [
  { label: "Subjective", key: "subjective" },
  { label: "Objective", key: "objective" },
  { label: "Assessment", key: "assessment" },
  { label: "Plan", key: "plan" },
] as const;

export function SoapNoteCard({ soapNote }: { soapNote: SoapNote | null }) {
  if (!soapNote) {
    return (
      <div className="rounded-xl border border-border/50 bg-card px-3.5 py-3 text-[13px] text-muted-foreground shadow-(--shadow-card)">
        No SOAP note found for this encounter.
      </div>
    );
  }

  const parsedDate = parseNoteDate(soapNote.date);
  const isSigned = soapNote.authorized === 1;

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card) transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-border">
      <div className="w-[3px] shrink-0 self-stretch bg-violet-500/70" />

      <div className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-[11px]">
        <div className="mt-px flex size-[33px] shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 ring-[1.5px] ring-violet-500/25 dark:text-violet-400">
          <ClipboardPen className="size-[15px]" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0.5">
            <span className="inline-flex items-center gap-1 font-semibold text-[12px] text-violet-600 tabular-nums dark:text-violet-400">
              <CalendarClock className="size-[11px] shrink-0" />
              {parsedDate
                ? format(parsedDate, "MMM d, yyyy · h:mm a")
                : soapNote.date}
            </span>
            {soapNote.user && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
                <UserRound className="size-[11px] shrink-0" />
                {soapNote.user}
              </span>
            )}
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full ms-auto px-1.5 py-0.5 font-semibold text-[10px] leading-none",
                isSigned
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground/60"
              )}
            >
              {isSigned && <ShieldCheck className="size-[10px] shrink-0" />}
              {isSigned ? "Signed" : "Unsigned"}
            </span>
          </div>

          <div className="mt-0.5 flex flex-col gap-2">
            {SECTIONS.map(({ label, key }) => {
              const text = soapNote[key];
              if (!text) return null;

              return (
                <div className="flex flex-col gap-0.5" key={key}>
                  <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground/40">
                    {label}
                  </span>
                  <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-muted-foreground">
                    {text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
