"use client";

import { format } from "date-fns";
import { Building2, CalendarClock, Clock } from "lucide-react";
import type { Encounter } from "@/lib/openemr/types";
import { parseDateSafe } from "@/lib/utils";
import { EmptyStateCard } from "./empty-state-card";

function EncounterCard({ encounter }: { encounter: Encounter }) {
  const parsedDate = parseDateSafe(encounter.date);

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card) transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-border">
      <div className="w-[3px] shrink-0 self-stretch bg-sky-500/70" />

      <div className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-[11px]">
        <div className="mt-px flex size-[33px] shrink-0 flex-col items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 ring-[1.5px] ring-sky-500/25 dark:text-sky-400">
          {parsedDate ? (
            <>
              <span className="font-bold text-[8px] uppercase leading-none tracking-wide">
                {format(parsedDate, "MMM")}
              </span>
              <span className="font-bold text-[14px] leading-none tabular-nums">
                {format(parsedDate, "d")}
              </span>
            </>
          ) : (
            <CalendarClock className="size-[15px]" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold text-[13px] tracking-[-0.012em] text-foreground">
              {encounter.reason || "Encounter"}
            </span>
            {encounter.pc_catname && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-sky-500/10 px-1.5 py-0.5 font-semibold text-[10px] text-sky-600 leading-none dark:text-sky-400">
                {encounter.pc_catname}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 font-semibold text-[12px] text-sky-600 tabular-nums dark:text-sky-400">
            <Clock className="size-[11px] shrink-0" />
            {parsedDate
              ? format(parsedDate, "MMM d, yyyy · h:mm a")
              : encounter.date}
          </div>

          {encounter.class_title && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground/40">
                CLASS
              </span>
              <span className="text-[11.5px] text-muted-foreground capitalize">
                {encounter.class_title}
              </span>
            </div>
          )}

          {encounter.facility_name && (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0.5">
              <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/60">
                <Building2 className="size-[11px] shrink-0" />
                <span className="truncate">{encounter.facility_name}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Encounters({ encounters }: { encounters: Encounter[] }) {
  if (encounters.length === 0) {
    return (
      <EmptyStateCard>No encounters found for this patient.</EmptyStateCard>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground/50">
        <CalendarClock className="size-3.5" />
        {encounters.length} encounter{encounters.length === 1 ? "" : "s"}
      </div>
      {encounters.map((encounter) => (
        <EncounterCard
          encounter={encounter}
          key={encounter.euuid ?? encounter.eid}
        />
      ))}
    </div>
  );
}
