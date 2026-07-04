import {
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";
import type { OpenEmrResponse, Patient, SoapNote } from "@/lib/openemr/types";

// Fetch the SOAP note for one encounter, for the expandable encounter cards.
// GET /api/openemr/soap-note?puuid=<patient uuid>&eid=<encounter id>
//
// OpenEMR's soap_note endpoint is keyed by the legacy numeric pid, but the
// client only knows the patient uuid from the getEncounters tool call, so the
// pid is resolved here first.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");
  const eid = searchParams.get("eid");

  if (!(puuid && eid)) {
    return Response.json({ error: "missing_params" }, { status: 400 });
  }

  try {
    const patient = await openemrFetch<OpenEmrResponse<Patient>>(
      `/api/patient/${encodeURIComponent(puuid)}`
    );
    const notes = await openemrFetch<SoapNote[]>(
      `/api/patient/${patient.data.pid}/encounter/${encodeURIComponent(eid)}/soap_note`
    );
    return Response.json(notes[0] ?? null);
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
