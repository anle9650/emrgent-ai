import { z } from "zod";
import { OpenEmrApiError, OpenEmrNotConnectedError } from "@/lib/openemr/api";
import { checkOutAppointment } from "@/lib/openemr/appointment-checkout";

const bodySchema = z.object({
  pid: z.number().int().positive(),
  eid: z.string().min(1),
});

// Flip a scribe session's linked appointment to "Checked out". Invoked by the
// ViewChartCard's Check Out button (a direct client action, not a model tool).
// The heavy lifting — recreate with the new status, then delete the original —
// lives in checkOutAppointment; this just proxies it as the signed-in user.
// POST /api/openemr/appointment-checkout  { pid, eid }
export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    return Response.json(await checkOutAppointment(parsed));
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
