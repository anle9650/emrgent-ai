import { z } from "zod";
import { OpenEmrApiError, OpenEmrNotConnectedError } from "@/lib/openemr/api";
import { fetchAvailableAppointments } from "@/lib/openemr/available-appointments";

const querySchema = z.object({
  duration: z.coerce.number().int().positive(),
  title: z.string().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});

// Open appointment slots for the interactive scheduling picker. The picker
// fetches candidates itself (client-side) so the slot list never enters the
// model's context; this proxies the calendar read as the signed-in user.
// GET /api/openemr/available-appointments?duration=900&startDate=...&...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse(
    Object.fromEntries(
      [...searchParams.entries()].filter(([, value]) => value !== "")
    )
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid_query" }, { status: 400 });
  }

  try {
    return Response.json(await fetchAvailableAppointments(parsed.data));
  } catch (error) {
    if (error instanceof OpenEmrNotConnectedError) {
      return Response.json(
        { error: "not_connected_to_openemr" },
        { status: 401 }
      );
    }
    if (error instanceof OpenEmrApiError) {
      return Response.json(
        { error: "openemr_api_error", status: error.status },
        { status: 502 }
      );
    }
    throw error;
  }
}
