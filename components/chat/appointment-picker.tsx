"use client";

import { format } from "date-fns";
import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import type { AppointmentCandidate } from "@/lib/openemr/types";
import { cn, parseDateSafe } from "@/lib/utils";
import { formatStartTime, relativeDayLabel } from "./appointments";
import { EmptyStateCard } from "./empty-state-card";

// The picker is deliberately two-step: clicking a slot only selects it, and a
// confirmation slip has to be dismissed or confirmed before anything is
// written. Booking is the one thing on this surface the user can't undo from
// chat, so it never happens on a stray click.
type PickerState =
  | { status: "idle" }
  | { status: "selected"; candidate: AppointmentCandidate }
  | { status: "booking"; candidate: AppointmentCandidate }
  | { status: "booked"; candidate: AppointmentCandidate };

// Slots shown per AM/PM ledger row before "more times". A fully open morning
// or afternoon is 12–20 quarter-hour chips; a sample keeps the card scannable
// while the ledger rows still show the shape of the day.
const SLOTS_PER_PERIOD = 4;

/**
 * An evenly-spaced sample across the period, in order — the first N would all
 * cluster at the start of it, which reads as "nothing later is available".
 */
function sampleSlots(candidates: AppointmentCandidate[], count: number) {
  if (candidates.length <= count) {
    return candidates;
  }
  const step = (candidates.length - 1) / (count - 1);
  return Array.from(
    { length: count },
    (_, index) => candidates[Math.round(index * step)]
  );
}

const slotKey = (candidate: AppointmentCandidate) =>
  `${candidate.pc_eventDate}T${candidate.pc_startTime}`;

function periodOf(candidate: AppointmentCandidate): "AM" | "PM" {
  return Number(candidate.pc_startTime.split(":")[0]) < 12 ? "AM" : "PM";
}

function durationLabel(seconds: string) {
  const minutes = Math.round(Number(seconds) / 60);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours}h ${rest}m`;
}

function slotSentence(candidate: AppointmentCandidate) {
  const parsed = parseDateSafe(candidate.pc_eventDate);
  const { time, meridiem } = formatStartTime(candidate.pc_startTime);
  const day = parsed
    ? `${relativeDayLabel(parsed) ?? format(parsed, "EEEE")}, ${format(parsed, "MMM d")}`
    : candidate.pc_eventDate;
  const duration = durationLabel(candidate.pc_duration);
  return `${day} at ${time} ${meridiem}${duration ? ` · ${duration}` : ""}`;
}

function SlotButton({
  candidate,
  selected,
  disabled,
  onSelect,
}: {
  candidate: AppointmentCandidate;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  // Meridiem is carried by the ledger row, so chips are bare tabular times.
  const { time } = formatStartTime(candidate.pc_startTime);

  if (disabled) {
    return (
      <span className="inline-flex items-center rounded-[6px] border border-border/40 px-2 py-1 font-semibold text-[12px] text-muted-foreground/60 leading-none tabular-nums">
        {time}
      </span>
    );
  }

  return (
    <button
      aria-label={`Select ${slotSentence(candidate)}`}
      aria-pressed={selected}
      className={cn(
        "inline-flex cursor-pointer items-center rounded-[6px] border px-2 py-1 font-semibold text-[12px] leading-none tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected
          ? "border-appointment bg-appointment/15 text-appointment"
          : "border-border/50 text-foreground hover:border-appointment/40 hover:bg-appointment/8"
      )}
      onClick={onSelect}
      type="button"
    >
      {time}
    </button>
  );
}

function PeriodRow({
  period,
  dayLabel,
  candidates,
  selectedKey,
  disabled,
  onSelect,
}: {
  period: "AM" | "PM";
  dayLabel: string;
  candidates: AppointmentCandidate[];
  selectedKey: string | null;
  disabled: boolean;
  onSelect: (candidate: AppointmentCandidate) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded
    ? candidates
    : sampleSlots(candidates, SLOTS_PER_PERIOD);
  const hidden = candidates.length - shown.length;

  return (
    <div className="flex px-3">
      {/* Period margin — the same ledger column appointment rows hang on */}
      <div className="flex w-[58px] shrink-0 flex-col items-end gap-1 border-border/40 border-r py-[11px] pr-2.5">
        <span className="font-mono text-[10px] text-muted-foreground uppercase leading-none tracking-[0.08em]">
          {period}
        </span>
        <span className="text-[10px] text-muted-foreground/70 leading-none tabular-nums">
          {candidates.length}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-[9px] pl-2.5">
        {shown.map((candidate) => (
          <SlotButton
            candidate={candidate}
            disabled={disabled}
            key={slotKey(candidate)}
            onSelect={() => onSelect(candidate)}
            selected={slotKey(candidate) === selectedKey}
          />
        ))}
        {hidden > 0 && (
          <button
            aria-label={`Show all ${candidates.length} ${period} times on ${dayLabel}`}
            className="inline-flex cursor-pointer items-center rounded-[6px] px-2 py-1 font-mono text-[10px] text-muted-foreground uppercase leading-none tracking-[0.08em] transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => setExpanded(true)}
            type="button"
          >
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  );
}

function DaySlots({
  date,
  candidates,
  selectedKey,
  disabled,
  onSelect,
}: {
  date: string;
  candidates: AppointmentCandidate[];
  selectedKey: string | null;
  disabled: boolean;
  onSelect: (candidate: AppointmentCandidate) => void;
}) {
  const parsed = parseDateSafe(date);
  const relative = parsed ? relativeDayLabel(parsed) : null;
  const dayLabel = parsed ? format(parsed, "EEEE, MMM d") : date;
  const morning = candidates.filter((c) => periodOf(c) === "AM");
  const afternoon = candidates.filter((c) => periodOf(c) === "PM");

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="w-[3px] shrink-0 self-stretch bg-appointment/70" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-border/50 border-b px-3 py-2">
          <span className="font-bold text-[10px] text-appointment uppercase tracking-[0.09em]">
            {parsed ? format(parsed, "EEE · MMM d") : date}
          </span>
          {relative && (
            <span className="inline-flex items-center rounded-full bg-appointment/10 px-1.5 py-0.5 font-semibold text-[10px] text-appointment leading-none">
              {relative}
            </span>
          )}
          <span className="ms-auto font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em] tabular-nums">
            {candidates.length} open
          </span>
        </div>

        <div className="flex flex-col divide-y divide-border/40">
          {morning.length > 0 && (
            <PeriodRow
              candidates={morning}
              dayLabel={dayLabel}
              disabled={disabled}
              onSelect={onSelect}
              period="AM"
              selectedKey={selectedKey}
            />
          )}
          {afternoon.length > 0 && (
            <PeriodRow
              candidates={afternoon}
              dayLabel={dayLabel}
              disabled={disabled}
              onSelect={onSelect}
              period="PM"
              selectedKey={selectedKey}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function AppointmentPicker({
  candidates,
  pid,
}: {
  candidates: AppointmentCandidate[];
  /** The patient to book for. Without it the slots render read-only — the
   * booking endpoint is keyed by pid and there's nothing to write against. */
  pid?: number;
}) {
  const [state, setState] = useState<PickerState>({ status: "idle" });

  if (candidates.length === 0) {
    return (
      <EmptyStateCard>
        No open appointment slots in that range. Try a wider date or time range.
      </EmptyStateCard>
    );
  }

  const bookable = pid !== undefined;
  const selected = state.status === "idle" ? null : (state.candidate ?? null);
  const booked = state.status === "booked" ? state.candidate : null;

  const confirm = async () => {
    if (state.status !== "selected" || pid === undefined) {
      return;
    }
    const { candidate } = state;
    setState({ status: "booking", candidate });
    try {
      const response = await fetch("/api/openemr/appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, candidate }),
      });
      if (!response.ok) {
        throw new Error(`Booking failed (${response.status})`);
      }
      setState({ status: "booked", candidate });
      toast.success(`Appointment booked — ${slotSentence(candidate)}.`);
    } catch {
      // Back to `selected`, not `idle`: the user keeps their choice and can
      // retry without hunting for the slot again.
      setState({ status: "selected", candidate });
      toast.error("Could not book that appointment. Please try again.");
    }
  };

  if (booked) {
    // The stamped slip — same anatomy as the confirmation slip, nothing left
    // to tear off.
    return (
      <div className="fade-in flex overflow-hidden rounded-xl border border-border/50 shadow-(--shadow-card) motion-reduce:animate-none">
        <div className="w-[3px] shrink-0 self-stretch bg-positive/70" />
        <div className="flex min-w-0 flex-1 items-center gap-3 bg-card bg-watermark px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-mono text-[10px] text-muted-foreground/70 uppercase leading-none tracking-[0.1em]">
              Appointment booked
            </span>
            <span className="truncate font-display font-bold text-[15px] text-foreground tracking-[0.01em]">
              {booked.pc_title} — {slotSentence(booked)}
            </span>
          </div>
          <span className="-rotate-2 inline-flex shrink-0 items-center rounded-[5px] border border-positive/50 px-2 py-1 font-mono text-[10px] text-positive uppercase leading-none tracking-[0.12em]">
            Booked
          </span>
        </div>
      </div>
    );
  }

  // One card per calendar day, slots in start-time order within each.
  const byDay = new Map<string, AppointmentCandidate[]>();
  for (const candidate of [...candidates].sort((a, b) =>
    slotKey(a).localeCompare(slotKey(b))
  )) {
    const day = byDay.get(candidate.pc_eventDate);
    if (day) {
      day.push(candidate);
    } else {
      byDay.set(candidate.pc_eventDate, [candidate]);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 px-0.5 font-mono font-normal text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
        <CalendarPlus aria-hidden="true" className="size-3.5" />
        Open slots
        <span className="text-muted-foreground/60 tabular-nums">
          · {candidates.length}
        </span>
      </h3>

      {[...byDay.entries()].map(([date, daySlots]) => (
        <DaySlots
          candidates={daySlots}
          date={date}
          disabled={!bookable}
          key={date}
          onSelect={(candidate) => setState({ status: "selected", candidate })}
          selectedKey={selected ? slotKey(selected) : null}
        />
      ))}

      {bookable ? (
        selected && (
          <div className="fade-in flex overflow-hidden rounded-xl border border-appointment/40 shadow-(--shadow-card) motion-reduce:animate-none">
            <div className="w-[3px] shrink-0 self-stretch bg-appointment/70" />
            <div className="flex min-w-0 flex-1 flex-col bg-card bg-watermark">
              <div className="flex flex-col gap-1 px-4 py-3">
                <span className="font-mono text-[10px] text-appointment uppercase leading-none tracking-[0.1em]">
                  Appointment slip
                </span>
                <span className="font-display font-bold text-[15px] text-foreground tracking-[0.01em]">
                  {selected.pc_title} — {slotSentence(selected)}
                </span>
              </div>
              {/* Tear-off line: the slip above, the decision below */}
              <div className="flex flex-wrap items-center justify-end gap-1.5 border-border/60 border-t border-dashed bg-muted/30 px-3 py-2">
                <button
                  className="inline-flex cursor-pointer items-center rounded-md px-2 py-1 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={state.status === "booking"}
                  onClick={() => setState({ status: "idle" })}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-mono text-[10px] text-primary-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={state.status === "booking"}
                  onClick={confirm}
                  type="button"
                >
                  {state.status === "booking" && <Spinner className="size-3" />}
                  Book appointment
                </button>
              </div>
            </div>
          </div>
        )
      ) : (
        <p className="px-0.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
          No patient selected — search for a patient to book one of these.
        </p>
      )}
    </div>
  );
}
