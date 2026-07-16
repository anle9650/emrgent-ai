"use client";

import { format, isToday, isTomorrow } from "date-fns";
import {
  Building2,
  CalendarDays,
  FolderOpen,
  Mic,
  Stethoscope,
  UserRound,
} from "lucide-react";
import type { MouseEvent } from "react";
import { useArtifact } from "@/hooks/use-artifact";
import type { Appointment } from "@/lib/openemr/types";
import { cn, parseDateSafe } from "@/lib/utils";
import { EmptyStateCard } from "./empty-state-card";
import {
  patientOverviewArtifact,
  toSparsePatientSummary,
} from "./patient-overview-artifact";

// OpenEMR stores appointment status as single punch-card-style codes.
type StatusTone = "neutral" | "positive" | "attention" | "negative";

const APPOINTMENT_STATUSES: Record<
  string,
  { label: string; tone: StatusTone }
> = {
  "-": { label: "Scheduled", tone: "neutral" },
  "*": { label: "Reminder sent", tone: "neutral" },
  "+": { label: "Chart pulled", tone: "neutral" },
  "^": { label: "Pending", tone: "attention" },
  "~": { label: "Arrived late", tone: "attention" },
  "@": { label: "Arrived", tone: "positive" },
  "<": { label: "In exam room", tone: "positive" },
  ">": { label: "Checked out", tone: "neutral" },
  $: { label: "Coding done", tone: "neutral" },
  "?": { label: "No show", tone: "negative" },
  x: { label: "Cancelled", tone: "negative" },
  "%": { label: "Cancelled <24h", tone: "negative" },
  "!": { label: "Left w/o visit", tone: "negative" },
};

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground/70",
  positive: "bg-positive/10 text-positive",
  attention: "bg-attention/10 text-attention",
  negative: "bg-negative/10 text-negative",
};

function statusOf(appointment: Appointment) {
  return (
    APPOINTMENT_STATUSES[appointment.pc_apptstatus] ?? {
      label: "Scheduled",
      tone: "neutral" as const,
    }
  );
}

// "14:30:00" -> { time: "2:30", meridiem: "PM" }
function formatStartTime(raw: string) {
  const [hourStr, minuteStr] = raw.split(":");
  const hour = Number(hourStr);
  if (!Number.isFinite(hour)) {
    return { time: raw, meridiem: "" };
  }
  return {
    time: `${hour % 12 || 12}:${minuteStr ?? "00"}`,
    meridiem: hour >= 12 ? "PM" : "AM",
  };
}

function durationLabel(start: string, end: string) {
  const toMinutes = (raw: string) => {
    const [hours, minutes] = raw.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const total = toMinutes(end) - toMinutes(start);
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} hr` : `${hours}h ${minutes}m`;
}

function relativeDayLabel(date: Date) {
  if (isToday(date)) {
    return "Today";
  }
  if (isTomorrow(date)) {
    return "Tomorrow";
  }
  return null;
}

function AppointmentRow({
  appointment,
  interactive,
  onSelect,
}: {
  appointment: Appointment;
  interactive: boolean;
  onSelect?: (appointment: Appointment) => void;
}) {
  const { setArtifact } = useArtifact();
  const status = statusOf(appointment);
  const missed = status.tone === "negative";
  const { time, meridiem } = formatStartTime(appointment.pc_startTime);
  const duration = durationLabel(
    appointment.pc_startTime,
    appointment.pc_endTime
  );
  const patientName = [appointment.fname, appointment.lname]
    .filter(Boolean)
    .join(" ");
  const providerName = [appointment.pce_aid_fname, appointment.pce_aid_lname]
    .filter(Boolean)
    .join(" ");
  // The overview route needs both the uuid (envelope endpoints) and the
  // numeric pid (legacy endpoints) to aggregate the chart.
  const clickable =
    interactive && Boolean(appointment.puuid && appointment.pid);

  const openOverview = (event: MouseEvent<HTMLButtonElement>) => {
    // Sparse snapshot from the calendar join — name and DOB render in the
    // demographics header immediately; the rest of the chart is fetched fresh.
    setArtifact(
      patientOverviewArtifact(
        toSparsePatientSummary({
          uuid: appointment.puuid,
          pid: Number(appointment.pid),
          name: patientName,
          DOB: appointment.DOB,
        }),
        event.currentTarget.getBoundingClientRect()
      )
    );
  };

  const body = (
    <>
      {/* Time margin — the ledger column every entry hangs on */}
      <div className="flex w-[58px] shrink-0 flex-col items-end gap-0.5 border-border/40 border-r py-[11px] pr-2.5">
        <span className="font-semibold text-[13px] text-foreground leading-none tabular-nums">
          {time}
          {meridiem && (
            <span className="ml-0.5 font-bold text-[8.5px] text-muted-foreground/70">
              {meridiem}
            </span>
          )}
        </span>
        {duration && (
          <span className="text-[10px] text-muted-foreground/70 tabular-nums">
            {duration}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 py-[11px] pl-2.5">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate font-semibold text-[13px] tracking-[-0.012em]",
              missed
                ? "text-muted-foreground/60 line-through decoration-muted-foreground/40"
                : "text-foreground"
            )}
          >
            {appointment.pc_title || "Appointment"}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 font-semibold text-[10px] leading-none",
                STATUS_TONE_CLASSES[status.tone]
              )}
            >
              {status.label}
            </span>
            {clickable &&
              (onSelect ? (
                <Mic className="size-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-focus-visible/appointment:opacity-100 group-hover/appointment:opacity-100 pointer-coarse:opacity-100" />
              ) : (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-focus-visible/appointment:opacity-100 group-hover/appointment:opacity-100 pointer-coarse:opacity-100" />
              ))}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0.5">
          {patientName && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <UserRound className="size-[11px] shrink-0" />
              {patientName}
            </span>
          )}
          {providerName && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Stethoscope className="size-[11px] shrink-0" />
              {providerName}
            </span>
          )}
          {appointment.facility_name && (
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/60">
              <Building2 className="size-[11px] shrink-0" />
              <span className="truncate">{appointment.facility_name}</span>
            </span>
          )}
        </div>
      </div>
    </>
  );

  return clickable ? (
    <button
      aria-label={
        onSelect
          ? `Select appointment for ${patientName || "patient"}`
          : `Open chart overview for ${patientName || "patient"}`
      }
      className="group/appointment flex w-full cursor-pointer px-3 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      onClick={onSelect ? () => onSelect(appointment) : openOverview}
      type="button"
    >
      {body}
    </button>
  ) : (
    // Dim only rows that would be clickable in this context but lack chart
    // ids — interactive=false lists are uniformly inert and stay full-strength.
    <div className={cn("flex px-3", interactive && "opacity-60")}>{body}</div>
  );
}

function DayCard({
  date,
  appointments,
  interactive,
  onSelect,
}: {
  date: string;
  appointments: Appointment[];
  interactive: boolean;
  onSelect?: (appointment: Appointment) => void;
}) {
  const parsed = parseDateSafe(date);
  const relative = parsed ? relativeDayLabel(parsed) : null;

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
            {appointments.length} appt{appointments.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex flex-col divide-y divide-border/40">
          {appointments.map((appointment) => (
            <AppointmentRow
              appointment={appointment}
              interactive={interactive}
              key={appointment.pc_uuid ?? appointment.pc_eid}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Appointments({
  appointments,
  interactive = true,
  hideHeader = false,
  onSelectAppointment,
}: {
  appointments: Appointment[];
  /** When false, rows don't open the patient-overview artifact — used inside
   * the overview itself, where that patient's chart is already open. */
  interactive?: boolean;
  /** When true, skips the list-level header — used where the surrounding
   * page already labels the section (e.g. the scribe session picker). */
  hideHeader?: boolean;
  /** When set, clicking a row calls this instead of opening the
   * patient-overview artifact — used by the scribe session picker. */
  onSelectAppointment?: (appointment: Appointment) => void;
}) {
  if (appointments.length === 0) {
    return (
      <EmptyStateCard>No appointments found on the calendar.</EmptyStateCard>
    );
  }

  // One card per calendar day, entries ordered by start time within each.
  const byDay = new Map<string, Appointment[]>();
  const sorted = [...appointments].sort((a, b) =>
    `${a.pc_eventDate} ${a.pc_startTime}`.localeCompare(
      `${b.pc_eventDate} ${b.pc_startTime}`
    )
  );
  for (const appointment of sorted) {
    const day = byDay.get(appointment.pc_eventDate);
    if (day) {
      day.push(appointment);
    } else {
      byDay.set(appointment.pc_eventDate, [appointment]);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!hideHeader && (
        <h3 className="flex items-center gap-1.5 px-0.5 font-mono font-normal text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
          <CalendarDays aria-hidden="true" className="size-3.5" />
          Appointments
          <span className="text-muted-foreground/60 tabular-nums">
            · {appointments.length}
          </span>
        </h3>
      )}
      {[...byDay.entries()].map(([date, dayAppointments]) => (
        <DayCard
          appointments={dayAppointments}
          date={date}
          interactive={interactive}
          key={date}
          onSelect={onSelectAppointment}
        />
      ))}
    </div>
  );
}
