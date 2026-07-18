import type { Appointment, AppointmentCandidate } from "@/lib/openemr/types";

// Deriving open slots from the booked calendar. Pure functions — no OpenEMR
// calls — so the scheduling rules are unit-testable on their own.

export const DEFAULT_START_TIME = "09:00";
export const DEFAULT_END_TIME = "17:00";

// Candidate start times land on a quarter-hour grid regardless of how long
// the appointment is, so a 45-minute visit can still start at 9:15.
export const SLOT_STEP_MINUTES = 15;

// OpenEMR's default seed data. Every candidate is booked as a plain office
// visit; the model has no say in the category.
export const OFFICE_VISIT_CATEGORY_ID = "5";
export const OFFICE_VISIT_TITLE = "Office Visit";

const MINUTES_PER_DAY = 24 * 60;

/** "09:00" / "09:00:00" -> minutes since midnight. NaN-free: invalid -> null. */
function toMinutes(time: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!match) {
    return null;
  }
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < MINUTES_PER_DAY ? minutes : null;
}

function toClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

type Interval = { start: number; end: number };

/**
 * The booked interval an appointment occupies, in minutes since midnight.
 * `pc_duration` is the authoritative field but isn't in the read type's
 * contract, so fall back to `pc_endTime` and finally to a nominal slot.
 */
function toBookedInterval(
  appointment: Appointment,
  fallbackMinutes: number
): Interval | null {
  const start = toMinutes(appointment.pc_startTime);
  if (start === null) {
    return null;
  }
  const duration = Number(appointment.pc_duration);
  if (Number.isFinite(duration) && duration > 0) {
    return { start, end: start + Math.ceil(duration / 60) };
  }
  const end = toMinutes(appointment.pc_endTime);
  if (end !== null && end > start) {
    return { start, end };
  }
  return { start, end: start + fallbackMinutes };
}

/** Local-calendar date strings, inclusive, skipping weekends. */
function weekdaysBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  // Midday avoids DST edges shifting the local date when stepping by a day.
  const cursor = new Date(`${startDate}T12:00:00`);
  const last = new Date(`${endDate}T12:00:00`);
  while (cursor <= last) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
          cursor.getDate()
        ).padStart(2, "0")}`
      );
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export type BuildCandidatesOptions = {
  /** Every appointment already on the calendar in the date range. */
  booked: Appointment[];
  /** Requested appointment length, in seconds. */
  duration: number;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  /** Cap on returned candidates, so a wide range can't blow up the surface. */
  limit?: number;
};

export function buildAppointmentCandidates({
  booked,
  duration,
  startDate,
  endDate,
  startTime = DEFAULT_START_TIME,
  endTime = DEFAULT_END_TIME,
  limit = 200,
}: BuildCandidatesOptions): AppointmentCandidate[] {
  const durationMinutes = Math.ceil(duration / 60);
  const windowStart = toMinutes(startTime) ?? toMinutes(DEFAULT_START_TIME);
  const windowEnd = toMinutes(endTime) ?? toMinutes(DEFAULT_END_TIME);
  if (
    durationMinutes <= 0 ||
    windowStart === null ||
    windowEnd === null ||
    windowEnd <= windowStart
  ) {
    return [];
  }

  const bookedByDate = new Map<string, Interval[]>();
  for (const appointment of booked) {
    const interval = toBookedInterval(appointment, durationMinutes);
    if (interval) {
      const day = bookedByDate.get(appointment.pc_eventDate) ?? [];
      day.push(interval);
      bookedByDate.set(appointment.pc_eventDate, day);
    }
  }

  const candidates: AppointmentCandidate[] = [];
  for (const date of weekdaysBetween(startDate, endDate)) {
    const intervals = bookedByDate.get(date) ?? [];
    for (
      let start = windowStart;
      start + durationMinutes <= windowEnd;
      start += SLOT_STEP_MINUTES
    ) {
      const end = start + durationMinutes;
      const overlaps = intervals.some(
        (interval) => start < interval.end && end > interval.start
      );
      if (overlaps) {
        continue;
      }
      candidates.push({
        pc_catid: OFFICE_VISIT_CATEGORY_ID,
        pc_title: OFFICE_VISIT_TITLE,
        pc_duration: String(duration),
        pc_apptstatus: "-",
        pc_eventDate: date,
        pc_startTime: toClock(start),
      });
      if (candidates.length >= limit) {
        return candidates;
      }
    }
  }
  return candidates;
}
