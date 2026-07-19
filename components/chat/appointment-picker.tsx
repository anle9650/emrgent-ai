"use client";

import { format } from "date-fns";
import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import type { AppointmentCandidate } from "@/lib/openemr/types";
import { cn, parseDateSafe } from "@/lib/utils";
import { formatStartTime, relativeDayLabel } from "./appointments";
import { EmptyStateCard } from "./empty-state-card";

// The picker is deliberately two-step: clicking a slot only selects it, and a
// confirmation slip has to be dismissed or confirmed before anything is
// handed back. Confirming resolves the selectAppointmentSlot tool call — the
// agent then books the slot with createAppointment — so it never happens on
// a stray click.
type PickerState =
  | { status: "idle" }
  | { status: "selected"; candidate: AppointmentCandidate }
  | { status: "resolved" };

/** The scheduling window the model asked the picker to offer — the
 * selectAppointmentSlot tool call's input. */
export type SlotSelectionParams = {
  patient?: { pid: number; name?: string };
  duration: number;
  title?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
};

/** What the picker hands back to the paused tool call. */
export type SlotSelectionResult =
  | { chosenSlot: AppointmentCandidate }
  | { skipped: true };

// The openemr proxy routes report errors as plain `{ error }` bodies, not the
// `{code, cause}` shape the shared `fetcher` in lib/utils expects — local one.
async function proxyFetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "request_failed");
  }
  return response.json();
}

function availabilityUrl(params: SlotSelectionParams): string {
  const query = new URLSearchParams({ duration: String(params.duration) });
  for (const key of [
    "title",
    "startDate",
    "endDate",
    "startTime",
    "endTime",
  ] as const) {
    const value = params[key];
    if (value) {
      query.set(key, value);
    }
  }
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/openemr/available-appointments?${query}`;
}

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

export function slotSentence(candidate: AppointmentCandidate) {
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

/** The stamped booked slip — rendered by the createAppointment tool card once
 * the agent has written the appointment to the calendar. */
export function BookedSlip({ slot }: { slot: AppointmentCandidate }) {
  return (
    <div className="fade-in flex overflow-hidden rounded-xl border border-border/50 shadow-(--shadow-card) motion-reduce:animate-none">
      <div className="w-[3px] shrink-0 self-stretch bg-positive/70" />
      <div className="flex min-w-0 flex-1 items-center gap-3 bg-card bg-watermark px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-mono text-[10px] text-muted-foreground/70 uppercase leading-none tracking-[0.1em]">
            Appointment booked
          </span>
          <span className="truncate font-display font-bold text-[15px] text-foreground tracking-[0.01em]">
            {slot.pc_title} — {slotSentence(slot)}
          </span>
        </div>
        <span className="-rotate-2 inline-flex shrink-0 items-center rounded-[5px] border border-positive/50 px-2 py-1 font-mono text-[10px] text-positive uppercase leading-none tracking-[0.12em]">
          Booked
        </span>
      </div>
    </div>
  );
}

function SkipButton({
  onSkip,
  label = "Not now",
}: {
  onSkip: () => void;
  label?: string;
}) {
  return (
    <button
      className="inline-flex cursor-pointer items-center rounded-md px-2 py-1 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onSkip}
      type="button"
    >
      {label}
    </button>
  );
}

export function AppointmentPicker({
  params,
  onResolved,
}: {
  /** The scheduling window from the selectAppointmentSlot call's input. */
  params: SlotSelectionParams;
  /** Hands the user's choice back to the paused tool call. Absent on
   * historical/read-only renders — slots then render inert. */
  onResolved?: (result: SlotSelectionResult) => void;
}) {
  const [state, setState] = useState<PickerState>({ status: "idle" });
  const {
    data: candidates,
    error,
    isLoading,
    mutate,
  } = useSWR<AppointmentCandidate[]>(availabilityUrl(params), proxyFetcher, {
    revalidateOnFocus: false,
  });

  const resolvable = Boolean(onResolved) && state.status !== "resolved";
  const resolve = (result: SlotSelectionResult) => {
    if (!resolvable) {
      return;
    }
    setState({ status: "resolved" });
    onResolved?.(result);
  };

  if (isLoading) {
    return (
      <div className="flex animate-pulse flex-col gap-2.5 rounded-xl border border-border/50 bg-card px-3.5 py-3 shadow-(--shadow-card) motion-reduce:animate-none">
        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
          Finding open slots…
        </div>
        <div className="h-14 rounded-lg bg-muted/60" />
      </div>
    );
  }

  if (error || !candidates) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-attention/30 bg-attention/5 px-3.5 py-3">
        <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">
          Could not load open appointment slots.
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <SkipButton
            label="Skip scheduling"
            onSkip={() => resolve({ skipped: true })}
          />
          <button
            className="inline-flex cursor-pointer items-center rounded-md bg-primary px-2.5 py-1 font-mono text-[10px] text-primary-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-primary/90"
            onClick={() => mutate()}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <EmptyStateCard>
          No open appointment slots in that range. Try a wider date or time
          range.
        </EmptyStateCard>
        {resolvable && (
          <div className="flex">
            <SkipButton
              label="Skip scheduling"
              onSkip={() => resolve({ skipped: true })}
            />
          </div>
        )}
      </div>
    );
  }

  const selected = state.status === "selected" ? state.candidate : null;

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
        {resolvable && (
          <span className="ms-auto">
            <SkipButton onSkip={() => resolve({ skipped: true })} />
          </span>
        )}
      </h3>

      {[...byDay.entries()].map(([date, daySlots]) => (
        <DaySlots
          candidates={daySlots}
          date={date}
          disabled={!resolvable}
          key={date}
          onSelect={(candidate) => setState({ status: "selected", candidate })}
          selectedKey={selected ? slotKey(selected) : null}
        />
      ))}

      {selected && (
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
            {/* Tear-off line: the slip above, the decision below. Confirming
                hands the slot to the agent, which books it. */}
            <div className="flex flex-wrap items-center justify-end gap-1.5 border-border/60 border-t border-dashed bg-muted/30 px-3 py-2">
              <button
                className="inline-flex cursor-pointer items-center rounded-md px-2 py-1 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-muted"
                onClick={() => setState({ status: "idle" })}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-mono text-[10px] text-primary-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-primary/90"
                onClick={() => resolve({ chosenSlot: selected })}
                type="button"
              >
                Book appointment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
