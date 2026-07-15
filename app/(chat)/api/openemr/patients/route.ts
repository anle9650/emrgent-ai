import {
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";
import { toPatientSummary } from "@/lib/openemr/summaries";
import type { OpenEmrResponse, Patient } from "@/lib/openemr/types";

// Proxy patient search as the signed-in user, for client components (the
// scribe patient picker). Mirrors the searchPatients AI tool.
// GET /api/openemr/patients?fname=&lname=
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const response = await openemrFetch<OpenEmrResponse<Patient[]>>(
      "/api/patient",
      {
        fname: searchParams.get("fname") ?? undefined,
        lname: searchParams.get("lname") ?? undefined,
      }
    );
    const patients = response.data
      .sort(
        (a, b) =>
          a.fname.localeCompare(b.fname) || a.lname.localeCompare(b.lname)
      )
      .map(toPatientSummary);
    return Response.json(patients);
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
