import { OpenEmrNotConnectedError } from "@/lib/openemr/api";
import { fetchPatientOverview } from "@/lib/openemr/patient-overview";

// Client-side proxy for the chart aggregation in lib/openemr/patient-overview.
// GET /api/openemr/patient-overview?uuid=<patient uuid>&pid=<patient pid>
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uuid = searchParams.get("uuid");
  const pid = searchParams.get("pid");

  if (!(uuid && pid)) {
    return Response.json({ error: "missing_params" }, { status: 400 });
  }

  try {
    return Response.json(await fetchPatientOverview(uuid, pid));
  } catch (error) {
    if (error instanceof OpenEmrNotConnectedError) {
      return Response.json(
        { error: "not_connected_to_openemr" },
        { status: 401 }
      );
    }
    throw error;
  }
}
