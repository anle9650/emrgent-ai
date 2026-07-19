import { tool } from "ai";
import { z } from "zod";
import { appointmentCandidateSchema, patientRefSchema } from "./openemr";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .optional();

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24-hour)")
  .optional();

// A client-interactive tool: it has NO execute, so calling it ends the
// server's turn and the run stays paused until the browser supplies the
// result (the picker card resolves it via addToolOutput when the user picks
// a slot or skips). The card fetches open slots itself from the
// available-appointments proxy, so the slot list never enters the model's
// context.
export const selectAppointmentSlot = tool({
  description:
    "Show the user an interactive scheduling card of open appointment slots matching these parameters. The card fetches availability itself; the run waits until the user picks a slot or skips. Call it at most once per scheduling request, and once it resolves with a chosen slot, book it with createAppointment. Do not call any other tool in the same step.",
  inputSchema: z.object({
    patient: patientRefSchema.describe(
      "The patient the appointment would be booked for, from `searchPatients` (or the scribe kickoff)."
    ),
    duration: z
      .number()
      .int()
      .positive()
      .describe(
        "Appointment length in seconds (900 = 15 minutes, a standard office visit)."
      ),
    title: z
      .string()
      .optional()
      .describe(
        'Short label for the appointment, e.g. "A1c recheck". Defaults to "Office Visit".'
      ),
    startDate: isoDate.describe(
      "First date to offer slots on. Defaults to today."
    ),
    endDate: isoDate.describe(
      "Last date to offer slots on. Defaults to a week out."
    ),
    startTime: clockTime.describe(
      "Earliest start time of day. Defaults to 09:00."
    ),
    endTime: clockTime.describe(
      "Latest end time of day — a slot must finish by then. Defaults to 17:00."
    ),
  }),
  outputSchema: z.union([
    z.object({
      chosenSlot: appointmentCandidateSchema.describe(
        "The slot the user picked."
      ),
    }),
    z.object({
      skipped: z
        .literal(true)
        .describe("The user chose not to schedule right now."),
    }),
  ]),
});
