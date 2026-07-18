import { z } from "zod";
import {
  jsonPost,
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";

const bookingSchema = z.object({
  pid: z.number().int().positive(),
  candidate: z.object({
    pc_catid: z.string(),
    pc_title: z.string(),
    pc_duration: z.string(),
    pc_apptstatus: z.string(),
    pc_eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pc_startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
});

// Book an open slot, for the appointment picker card in chat. The AI tools
// call openemrFetch directly; client components can't, so this proxies the
// write as the signed-in user (and inherits the process-wide write queue).
// POST /api/openemr/appointment
// Body: { pid, candidate: AppointmentCandidate }
export async function POST(request: Request) {
  let parsed: z.infer<typeof bookingSchema>;
  try {
    parsed = bookingSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const created = await openemrFetch(
      `/api/patient/${parsed.pid}/appointment`,
      undefined,
      jsonPost(parsed.candidate)
    );
    return Response.json(created);
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
