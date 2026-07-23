import "server-only";
import { jsonPost, OpenEmrApiError, openemrFetch } from "@/lib/openemr/api";
import { OFFICE_VISIT_CATEGORY_ID } from "@/lib/openemr/availability";
import type { Appointment, AppointmentCandidate } from "@/lib/openemr/types";

/** OpenEMR appointment status ">" = "Checked out" (see APPOINTMENT_STATUSES in
 * components/chat/appointments.tsx). */
const CHECKED_OUT = ">";
/** Nominal office-visit length, in seconds, when the source row omits duration. */
const DEFAULT_DURATION_SECONDS = "1800";

export type CheckOutResult =
  /** Nothing to do — the appointment was already checked out (or already gone
   * from a prior run's recreate+delete). */
  | { status: "already" }
  /** Recreated with ">" status; `cleanup` is false when the original couldn't
   * be deleted (a redundant duplicate remains, recoverable on a later run). */
  | { status: "checked-out"; cleanup: boolean };

// Fetch a single appointment by its calendar id. Returns null when it no
// longer exists (deleted → 404). getOne uses the same responseHandler as the
// list endpoint, so the row comes back as a bare (single-element) array.
async function getAppointment(eid: string): Promise<Appointment | null> {
  try {
    const result = await openemrFetch<Appointment[] | Appointment | null>(
      `/api/appointment/${eid}`
    );
    if (Array.isArray(result)) {
      return result[0] ?? null;
    }
    return result ?? null;
  } catch (error) {
    if (error instanceof OpenEmrApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Check a patient's appointment out by flipping its status to ">".
 *
 * OpenEMR exposes no update endpoint for appointments, so this recreates the
 * appointment with the new status and deletes the original. Recreate runs
 * FIRST: if a step fails midway the worst case is a recoverable duplicate,
 * never a lost appointment. Idempotent — a second call (original already gone
 * or already ">") is a no-op, so retries/double-submits can't pile up
 * duplicate ">" rows.
 */
export async function checkOutAppointment({
  pid,
  eid,
}: {
  pid: number;
  eid: string;
}): Promise<CheckOutResult> {
  const original = await getAppointment(eid);

  // Original gone → a prior run already checked it out. Do NOT recreate again.
  if (!original) {
    return { status: "already" };
  }
  if (original.pc_apptstatus === CHECKED_OUT) {
    return { status: "already" };
  }

  // Recreate with the checked-out status. Our typed Appointment omits
  // `pc_catid`, so default to the office-visit category (matching how new
  // appointments are booked). Copy the rest from the source row.
  const recreated: AppointmentCandidate = {
    pc_catid: OFFICE_VISIT_CATEGORY_ID,
    pc_title: original.pc_title,
    pc_duration: original.pc_duration ?? DEFAULT_DURATION_SECONDS,
    pc_apptstatus: CHECKED_OUT,
    pc_eventDate: original.pc_eventDate,
    // The read row carries HH:MM:SS; the write shape expects HH:MM.
    pc_startTime: original.pc_startTime.slice(0, 5),
  };
  await openemrFetch(
    `/api/patient/${pid}/appointment`,
    undefined,
    jsonPost(recreated)
  );

  // Delete the now-redundant original. A failure here leaves the desired ">"
  // state in place (a later run finds the original still present and retries),
  // so report it as a soft "cleanup pending" rather than a hard failure.
  let cleanup = true;
  try {
    await openemrFetch(`/api/patient/${pid}/appointment/${eid}`, undefined, {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof OpenEmrApiError) {
      cleanup = false;
    } else {
      throw error;
    }
  }

  return { status: "checked-out", cleanup };
}
