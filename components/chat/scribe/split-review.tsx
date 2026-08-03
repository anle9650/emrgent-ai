"use client";

import { format } from "date-fns";
import { ChevronDownIcon, UserRoundSearch } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { EcgIcon } from "@/components/ecg-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ScribeSelection } from "@/lib/ai/scribe";
import {
  groupByPatient,
  matchScribePatient,
  type ScribeSendUnit,
  type SplitEncounter,
  wordCount,
} from "@/lib/ai/scribe-split";
import { proxyFetcher } from "@/lib/openemr/proxy-fetch";
import type { Appointment } from "@/lib/openemr/types";
import { cn } from "@/lib/utils";
import { PatientSelect } from "./patient-select";

type Assignment = {
  selection: ScribeSelection | null;
  included: boolean;
};

/** How much of the opening to quote in the assign dialog — enough to recognise
 * the stretch by ear, short enough to sit on a line or two. */
const OPENING_CHARS = 90;
/** No segment's bar drops below this, so a 3% tail stays legible next to a
 * 900-word visit. */
const MIN_SEGMENT_PX = 44;

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

  // How much of the recording each stretch is. Real word counts, so the strip
  // and the captions report the tape rather than decorating it — and a 40-word
  // tail reads as the likely false positive it is.
  const shares = useMemo(() => {
    const counts = encounters.map((encounter) => wordCount(encounter.text));
    const total = counts.reduce((sum, count) => sum + count, 0) || 1;
    return counts.map((count) =>
      Math.max(1, Math.round((count / total) * 100))
    );
  }, [encounters]);

  // Auto-suggestions, computed once the calendar arrives. excludePids grows as
  // we walk the list — not to stop two segments reaching one chart (that now
  // merges, and correctly), but so a wrong name hint can't land pre-filled.
  // See matchScribePatient.
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

  // For each stretch, the first stretch assigned to the same patient — its
  // group leader, or itself. Two stretches on one patient chart as one session,
  // so this drives both the shared tone and the "charted with" line.
  const groupLeaders = assignments.map((assignment, index) => {
    if (!(assignment.included && assignment.selection)) {
      return index;
    }
    const pid = assignment.selection.patient.pid;
    return assignments.findIndex(
      (other, otherIndex) =>
        otherIndex <= index &&
        other.included &&
        other.selection?.patient.pid === pid
    );
  });

  const included = assignments.filter((assignment) => assignment.included);
  const skippedCount = assignments.length - included.length;
  const unassigned = included.some((assignment) => !assignment.selection);

  // Sessions to start, not stretches to chart: two stretches on one patient
  // are one visit that got interrupted, and count as one.
  const units = groupByPatient(
    assignments.flatMap((assignment, index) =>
      assignment.included && assignment.selection
        ? [{ selection: assignment.selection, text: encounters[index].text }]
        : []
    )
  );

  // What the button promises to chart. An included-but-unassigned stretch
  // counts as its own prospective session — the button is disabled anyway, and
  // counting only the resolved ones would quietly drop the number the moment
  // the clinician is being asked to fix it.
  const sessionCount =
    units.length +
    included.filter((assignment) => !assignment.selection).length;

  const setAssignment = (index: number, next: Partial<Assignment>) =>
    setEdited((previous) => ({
      ...previous,
      [index]: { ...(previous[index] ?? suggested[index]), ...next },
    }));

  const chart = () => {
    if (units.length > 0) {
      onChart(units);
    }
  };

  return (
    <div className="fade-up mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 motion-reduce:animate-none">
      <header className="flex flex-col items-center gap-1.5 text-center">
        {/* The ornament the select and record stages open with — this is a
            stage of the session, not an interruption of one. */}
        <div className="mb-3 flex w-full max-w-xs items-center gap-3 text-primary">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/40" />
          <EcgIcon className="h-[18px] w-11 shrink-0" />
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/40" />
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.12em]">
          Recording review
        </span>
        <h2 className="font-display font-bold text-[24px] text-foreground tracking-[0.06em]">
          This recording covers {assignments.length} visits
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Confirm who each one belongs to. Nothing is charted until you do.
        </p>
      </header>

      <TapeStrip
        segments={encounters.map((encounter, index) => ({
          key: encounter.text.slice(0, 64),
          share: shares[index],
          included: assignments[index].included,
          groupLeader: groupLeaders[index],
        }))}
      />

      <div className="flex flex-col gap-3">
        {encounters.map((encounter, index) => (
          <EncounterCard
            assignment={assignments[index]}
            encounter={encounter}
            groupLeader={groupLeaders[index]}
            index={index}
            // Slices of one transcript, so their openings are distinct and
            // stable across the calendar revalidating underneath.
            key={encounter.text.slice(0, 64)}
            onAssign={(selection) => setAssignment(index, { selection })}
            onToggleInclude={(includedNext) =>
              setAssignment(index, { included: includedNext })
            }
            share={shares[index]}
            total={assignments.length}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-describedby={unassigned ? "split-blocked-reason" : undefined}
            data-testid="split-chart"
            disabled={unassigned || units.length === 0}
            onClick={chart}
          >
            {sessionCount === 1
              ? "Chart this visit"
              : `Chart ${sessionCount} visits`}
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
          <p
            className="text-[12px] text-muted-foreground"
            id="split-blocked-reason"
          >
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

/** Gold for the stretch this session started from, indigo ink for the rest —
 * the two tones the scribe flow already uses. Merged stretches borrow their
 * leader's tone, so a patient who stepped back in reads as one visit
 * interrupted rather than two unrelated ones. */
function toneFor(groupLeader: number) {
  return groupLeader === 0
    ? { bar: "bg-primary/70", dot: "bg-primary", spine: "bg-primary/70" }
    : { bar: "bg-encounter/70", dot: "bg-encounter", spine: "bg-encounter/70" };
}

/** The whole recording as one band, cut where the visits divide. Segment
 * widths are the real word shares, so the clinician can see how much tape is
 * about to be routed to another chart — and skipping one greys out exactly
 * what would be discarded. The gaps between segments are the cuts; they need
 * no further marking. */
function TapeStrip({
  segments,
}: {
  segments: {
    key: string;
    share: number;
    included: boolean;
    groupLeader: number;
  }[];
}) {
  return (
    <div
      aria-hidden="true"
      // The track is darker than either tone, so the gaps read as cuts through
      // the tape rather than as seams between two bars that happen to abut.
      className="flex w-full items-stretch gap-[7px] rounded-[5px] bg-foreground/12 p-[3px]"
    >
      {segments.map((segment, index) => {
        // Two adjacent stretches charted together are one visit again, so the
        // cut between them is un-made: the gap closes and the tape reads as a
        // single piece. Non-adjacent merges can't close, and don't need to —
        // the shared tone across the other patient's segment shows it.
        const joins = (other: (typeof segments)[number] | undefined) =>
          Boolean(
            segment.included &&
              other?.included &&
              other.groupLeader === segment.groupLeader
          );
        const joinsBefore = index > 0 && joins(segments[index - 1]);
        const joinsAfter = joins(segments[index + 1]);
        return (
          <div
            className={cn(
              "tape-cut h-2.5 rounded-[3px] motion-reduce:animate-none",
              segment.included
                ? toneFor(segment.groupLeader).bar
                : "bg-muted-foreground/20",
              joinsBefore && "rounded-s-none",
              joinsAfter && "rounded-e-none"
            )}
            key={segment.key}
            style={{
              flexGrow: segment.share,
              flexBasis: 0,
              minWidth: MIN_SEGMENT_PX,
              marginInlineStart: joinsBefore ? -7 : undefined,
              animationDelay: `${index * 60}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

function EncounterCard({
  assignment,
  encounter,
  index,
  total,
  share,
  groupLeader,
  onAssign,
  onToggleInclude,
}: {
  assignment: Assignment;
  encounter: SplitEncounter;
  index: number;
  total: number;
  share: number;
  groupLeader: number;
  onAssign: (selection: ScribeSelection) => void;
  onToggleInclude: (included: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  // Index 0 is the session the clinician actually started; its patient isn't
  // in question, only whether the rest of the recording belongs to them.
  const locked = index === 0;
  const tone = toneFor(groupLeader);
  const mergedInto = groupLeader === index ? null : groupLeader;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)",
        !assignment.included && "opacity-60"
      )}
      data-testid="split-encounter"
    >
      <div className="flex">
        <div className={cn("w-[3px] shrink-0 self-stretch", tone.spine)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="flex min-w-0 flex-col me-auto">
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
                Visit {index + 1} of {total}
                <span className="text-muted-foreground/40">·</span>
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", tone.dot)}
                />
                <span className="tabular-nums">{share}% of recording</span>
              </span>
              <span className="truncate font-display font-bold text-[15px] text-foreground tracking-[0.01em]">
                {assignment.selection?.patient.name ||
                  encounter.chiefComplaint ||
                  `Visit ${index + 1}`}
              </span>
              {assignment.selection && encounter.chiefComplaint && (
                <span className="truncate text-[12px] text-muted-foreground">
                  {encounter.chiefComplaint}
                </span>
              )}
              {/* The hint is the only clue to who this was when the calendar
                  can't resolve it — quoting it beats swallowing it, and it's
                  how the clinician spots a patient who stepped back in. */}
              {!assignment.selection && encounter.patientName && (
                <span className="truncate text-[12px] text-muted-foreground">
                  The recording says &ldquo;{encounter.patientName}&rdquo;
                </span>
              )}
              {mergedInto !== null && (
                <span className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
                  Charted with visit {mergedInto + 1}
                </span>
              )}
            </div>

            {assignment.selection ? null : (
              <span className="inline-flex items-center rounded-[5px] bg-attention/10 px-1.5 py-0.5 font-mono text-[10px] text-attention uppercase tracking-[0.08em]">
                Needs a patient
              </span>
            )}

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
            <DialogTitle>
              Assign visit {index + 1} of {total}
            </DialogTitle>
            <DialogDescription>
              {encounter.chiefComplaint
                ? `${encounter.chiefComplaint} · ${share}% of recording`
                : `${share}% of recording`}
            </DialogDescription>
          </DialogHeader>
          {/* The opening words, verbatim — the fastest way to know which
              stretch of tape this dialog is about. */}
          <p className="border-border/50 border-s-2 ps-3 font-mono text-[11px] text-muted-foreground/70 leading-[1.7]">
            {encounter.text.slice(0, OPENING_CHARS).trim()}…
          </p>
          <PatientSelect
            hideHeader
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
