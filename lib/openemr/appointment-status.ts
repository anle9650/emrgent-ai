import type { Appointment } from "./types";

// OpenEMR stores appointment status as single punch-card-style codes; the full
// code -> label map lives in components/chat/appointments.tsx. This is the one
// a patient gets once they're roomed and waiting to be seen. Server-side twin:
// `IN_EXAM_ROOM` in lib/ai/tools/openemr.ts (server-only, so it can't be shared
// with client components).
export const IN_EXAM_ROOM_STATUS = "<";

export function countInExamRoom(
  appointments: Appointment[] | undefined
): number {
  if (!appointments) {
    return 0;
  }
  return appointments.filter(
    (appointment) => appointment.pc_apptstatus === IN_EXAM_ROOM_STATUS
  ).length;
}
