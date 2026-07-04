"use client";

import { format } from "date-fns";
import { CalendarClock, PenLine, ShieldCheck, UserRound } from "lucide-react";
import type { MouseEvent } from "react";
import type { SoapArtifactPayload } from "@/artifacts/soap/client";
import { useArtifact } from "@/hooks/use-artifact";
import type { SoapNote } from "@/lib/openemr/types";
import { cn, parseDateSafe } from "@/lib/utils";
import { EmptyStateCard } from "./empty-state-card";

const SECTIONS = [
  { label: "Subjective", key: "subjective" },
  { label: "Objective", key: "objective" },
  { label: "Assessment", key: "assessment" },
  { label: "Plan", key: "plan" },
] as const;

/** Meta row (date, author, signed badge) plus the S/O/A/P sections, without
 * the card shell — reused inside the expandable encounter cards. */
export function SoapNoteBody({ soapNote }: { soapNote: SoapNote }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {soapNote.user && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
          <UserRound className="size-[11px] shrink-0" />
          {soapNote.user}
        </span>
      )}

      <div className="mt-0.5 flex flex-col gap-2">
        {SECTIONS.map(({ label, key }) => {
          const text = soapNote[key];
          if (!text) {
            return null;
          }

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
  );
}

export function SoapNoteCard({
  soapNote,
  eid,
}: {
  soapNote: SoapNote | null;
  /** Encounter id — enables click-to-edit when provided. */
  eid?: number | string;
}) {
  const { setArtifact } = useArtifact();

  if (!soapNote) {
    return (
      <EmptyStateCard>No SOAP note found for this encounter.</EmptyStateCard>
    );
  }

  const parsedDate = parseDateSafe(soapNote.date);
  const isSigned = soapNote.authorized === 1;
  const editable = eid !== undefined && eid !== "";

  const openEditor = (event: MouseEvent<HTMLButtonElement>) => {
    if (!editable) {
      return;
    }

    const boundingBox = event.currentTarget.getBoundingClientRect();
    const payload: SoapArtifactPayload = { eid, note: soapNote };

    setArtifact({
      documentId: `soap-note:${soapNote.pid}:${eid}:${soapNote.id}`,
      kind: "soap",
      content: JSON.stringify(payload),
      title: parsedDate
        ? `SOAP Note · ${format(parsedDate, "MMM d, yyyy")}`
        : "SOAP Note",
      isVisible: true,
      status: "idle",
      boundingBox: {
        top: boundingBox.top,
        left: boundingBox.left,
        width: boundingBox.width,
        height: boundingBox.height,
      },
    });
  };

  const cardBody = (
    <>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0.5">
        <span className="inline-flex items-center gap-1 font-semibold text-[12px] text-violet-600 tabular-nums dark:text-violet-400">
          <CalendarClock className="size-[11px] shrink-0" />
          {parsedDate
            ? format(parsedDate, "MMM d, yyyy · h:mm a")
            : soapNote.date}
        </span>
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
      <SoapNoteBody soapNote={soapNote} />
    </>
  );

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card) transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-border">
      <div className="w-[3px] shrink-0 self-stretch bg-violet-500/70" />
      {editable ? (
        <button
          className="group/soap min-w-0 flex-1 cursor-pointer px-3 py-[11px] text-left"
          onClick={openEditor}
          type="button"
        >
          {cardBody}
        </button>
      ) : (
        <div className="min-w-0 flex-1 px-3 py-[11px]">{cardBody}</div>
      )}
    </div>
  );
}
