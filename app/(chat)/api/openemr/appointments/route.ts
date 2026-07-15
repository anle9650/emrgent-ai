import {
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";
import type { Appointment } from "@/lib/openemr/types";

// Proxy the OpenEMR calendar as the signed-in user, for client components
// (the scribe patient/appointment picker). The AI tools call openemrFetch
// directly; client code can't, so this mirrors the getAppointments tool.
// GET /api/openemr/appointments?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  try {
    const appointments = await openemrFetch<Appointment[]>("/api/appointment");
    // The endpoint has no date filters, so filter here. pc_eventDate is
    // YYYY-MM-DD, which compares correctly as a string.
    const filtered = appointments.filter(
      (appointment) =>
        (!startDate || appointment.pc_eventDate >= startDate) &&
        (!endDate || appointment.pc_eventDate <= endDate)
    );
    return Response.json(filtered);
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
