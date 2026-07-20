import "server-only";
import { OpenEmrApiError, openemrFetch } from "@/lib/openemr/api";
import {
  buildAppointmentCandidates,
  type WeekdayName,
} from "@/lib/openemr/availability";
import type { Appointment, AppointmentCandidate } from "@/lib/openemr/types";

// Server-side open-slot computation, shared by the available-appointments
// client proxy route (which the scheduling picker fetches from). Extracted
// from the retired getAvailableAppointments AI tool so the slot list never
// has to pass through the model.

export type AvailabilityQuery = {
  /** Appointment length in seconds (900 = a standard office visit). */
  duration: number;
  title?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: WeekdayName[];
};

// Local calendar date, matching how OpenEMR stores pc_eventDate.
function localDatePlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export async function fetchAvailableAppointments(
  query: AvailabilityQuery
): Promise<AppointmentCandidate[]> {
  const today = localDatePlusDays(0);
  // Clamp to today: a slot in the past can't be booked, and models
  // occasionally compute a window backwards from the visit date. A range
  // entirely in the past yields no candidates, which the picker surfaces as
  // an empty state.
  const requestedStart = query.startDate ?? today;
  const startDate = requestedStart < today ? today : requestedStart;
  const endDate = query.endDate ?? localDatePlusDays(6);
  // Practice-wide, not the patient's own calendar: a slot is taken if
  // *anyone* is booked into it. OpenEMR responds 404 with a null body when
  // the calendar is empty — every slot is open, not a failure.
  let booked: Appointment[];
  try {
    booked =
      (await openemrFetch<Appointment[] | null>("/api/appointment")) ?? [];
  } catch (error) {
    if (error instanceof OpenEmrApiError && error.status === 404) {
      booked = [];
    } else {
      throw error;
    }
  }
  return buildAppointmentCandidates({
    booked: booked.filter(
      (appointment) =>
        appointment.pc_eventDate >= startDate &&
        appointment.pc_eventDate <= endDate
    ),
    duration: query.duration,
    startDate,
    endDate,
    startTime: query.startTime,
    endTime: query.endTime,
    title: query.title,
    daysOfWeek: query.daysOfWeek,
  });
}
