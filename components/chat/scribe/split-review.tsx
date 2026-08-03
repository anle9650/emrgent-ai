"use client";

import { format } from "date-fns";
import { ChevronDownIcon, TriangleAlert, UserRoundSearch } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ScribeSelection } from "@/lib/ai/scribe";
import { matchScribePatient, type SplitEncounter } from "@/lib/ai/scribe-split";
import { proxyFetcher } from "@/lib/openemr/proxy-fetch";
import type { Appointment } from "@/lib/openemr/types";
import { cn } from "@/lib/utils";
import { PatientSelect } from "./patient-select";

export type ScribeSendUnit = {
  selection: ScribeSelection;
  transcript: string;
};

type Assignment = {
  selection: ScribeSelection | null;
  included: boolean;
};

// Shown when the split check finds more than one visit in a single recording —
// the clinician forgot to stop recording and walked into the next room. Nothing
// has been charted at this point: this screen decides which transcript goes to
// which chart, and only then does any session start.
//
// Built for N encounters, not two. The detection schema allows up to five, and
// a recorder left running through a clinic block is exactly the failure this
// exists for.
export function SplitReview({
  encounters,
  currentSelection,
  onChart,
  onNotSplit,
}: {
  encounters: SplitEncounter[];
  currentSelection: ScribeSelection;
  onChart: (units: ScribeSendUnit[]) => void;
  onNotSplit: () => void;
}) {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  // Same key as PatientSelect's, so SWR serves this from cache when the picker
  // has already loaded today's calendar.
  const { data: appointments } = useSWR<Appointment[]>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/openemr/appointments?startDate=${today}&endDate=${today}`,
    proxyFetcher,
    { revalidateOnFocus: false }
  );

  // Auto-suggestions, computed once the calendar arrives. excludePids grows as
  // we walk the list, so two segments of one recording can never be routed to
  // the same chart — including the patient whose session this already is.
  const suggested = useMemo<Assignment[]>(() => {
    const excludePids = [currentSelection.patient.pid];
    return encounters.map((encounter, index) => {
      if (index === 0) {
        return { selection: currentSelection, included: true };
      }
      const match = matchScribePatient(
        encounter.patientName,
        appointments ?? [],
        excludePids
      );
      if (match) {
        excludePids.push(match.patient.pid);
      }
      return { selection: match, included: true };
    });
  }, [encounters, currentSelection, appointments]);

  // Suggestions seed the state; an edit sticks even when the calendar
  // revalidates underneath.
  const [edited, setEdited] = useState<Record<number, Assignment>>({});
  const assignments = suggested.map(
    (assignment, index) => edited[index] ?? assignment
  );

  const included = assignments.filter((assignment) => assignment.included);
  const skippedCount = assignments.length - included.length;
  const unassigned = included.some((assignment) => !assignment.selection);

  const setAssignment = (index: number, next: Partial<Assignment>) =>
    setEdited((previous) => ({
      ...previous,
      [index]: { ...(previous[index] ?? suggested[index]), ...next },
    }));

  const chart = () => {
    const units: ScribeSendUnit[] = [];
    assignments.forEach((assignment, index) => {
      if (assignment.included && assignment.selection) {
        units.push({
          selection: assignment.selection,
          transcript: encounters[index].text,
        });
      }
    });
    if (units.length > 0) {
      onChart(units);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex items-start gap-3 rounded-xl border border-attention/30 bg-attention/5 px-4 py-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-attention" />
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-attention uppercase tracking-[0.1em]">
            More than one visit detected
          </span>
          <p className="text-[13px] text-muted-foreground leading-[1.6]">
            This recording looks like it holds {assignments.length} separate
            visits — the recorder may have kept running into the next room.
            Confirm who each one belongs to before anything is charted.
          </p>
        </div>
      </div>

      {encounters.map((encounter, index) => (
        <EncounterCard
          assignment={assignments[index]}
          encounter={encounter}
          index={index}
          // Slices of one transcript, so their openings are distinct and
          // stable across the calendar revalidating underneath.
          key={encounter.text.slice(0, 64)}
          onAssign={(selection) => setAssignment(index, { selection })}
          onToggleInclude={(includedNext) =>
            setAssignment(index, { included: includedNext })
          }
          total={assignments.length}
        />
      ))}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid="split-chart"
            disabled={unassigned || included.length === 0}
            onClick={chart}
          >
            {included.length === 1
              ? "Chart this visit"
              : `Chart ${included.length} visits`}
          </Button>
          <Button
            data-testid="split-not-split"
            onClick={onNotSplit}
            variant="ghost"
          >
            It&apos;s one visit
          </Button>
        </div>
        {unassigned && (
          <p className="text-[12px] text-muted-foreground">
            Assign a patient to every visit you&apos;re charting, or skip it.
          </p>
        )}
        {skippedCount > 0 && (
          <p className="text-[12px] text-muted-foreground">
            {skippedCount} visit{skippedCount === 1 ? "" : "s"} won&apos;t be
            charted — {skippedCount === 1 ? "its" : "their"} transcript is
            discarded.
          </p>
        )}
      </div>
    </div>
  );
}

function EncounterCard({
  assignment,
  encounter,
  index,
  total,
  onAssign,
  onToggleInclude,
}: {
  assignment: Assignment;
  encounter: SplitEncounter;
  index: number;
  total: number;
  onAssign: (selection: ScribeSelection) => void;
  onToggleInclude: (included: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  // Index 0 is the session the clinician actually started; its patient isn't
  // in question, only whether the rest of the recording belongs to them.
  const locked = index === 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)",
        !assignment.included && "opacity-60"
      )}
      data-testid="split-encounter"
    >
      <div className="flex">
        <div
          className={cn(
            "w-[3px] shrink-0 self-stretch",
            locked ? "bg-primary/70" : "bg-encounter/70"
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="flex min-w-0 flex-col me-auto">
              <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
                Visit {index + 1} of {total}
              </span>
              <span className="truncate font-display font-bold text-[15px] text-foreground tracking-[0.01em]">
                {assignment.selection?.patient.name ?? "Unassigned patient"}
              </span>
              {encounter.chiefComplaint && (
                <span className="truncate text-[12px] text-muted-foreground">
                  {encounter.chiefComplaint}
                </span>
              )}
            </div>

            {locked ? (
              <span className="inline-flex items-center rounded-[5px] bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary uppercase tracking-[0.08em]">
                This session
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  className="h-7"
                  data-testid="split-change-patient"
                  onClick={() => setPicking(true)}
                  size="sm"
                  variant="outline"
                >
                  <UserRoundSearch className="size-3.5" />
                  {assignment.selection ? "Change" : "Choose patient"}
                </Button>
                <Button
                  className="h-7"
                  data-testid="split-toggle-skip"
                  onClick={() => onToggleInclude(!assignment.included)}
                  size="sm"
                  variant="ghost"
                >
                  {assignment.included ? "Skip" : "Include"}
                </Button>
              </div>
            )}
          </div>

          <div className="px-4 pb-3">
            <button
              aria-expanded={open}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/50 px-2 py-1 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-muted/40 hover:text-foreground"
              onClick={() => setOpen((previous) => !previous)}
              type="button"
            >
              <ChevronDownIcon
                className={cn(
                  "size-3 transition-transform duration-150",
                  open && "rotate-180"
                )}
              />
              Transcript
            </button>
          </div>

          {open && (
            <p
              className="max-h-64 overflow-y-auto whitespace-pre-wrap border-border/40 border-t px-4 py-3 text-[13px] text-muted-foreground leading-[1.6]"
              data-testid="split-transcript"
            >
              {encounter.text}
            </p>
          )}
        </div>
      </div>

      <Dialog onOpenChange={setPicking} open={picking}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Who was this visit with?</DialogTitle>
          </DialogHeader>
          <PatientSelect
            onSelect={(selection) => {
              onAssign(selection);
              setPicking(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
