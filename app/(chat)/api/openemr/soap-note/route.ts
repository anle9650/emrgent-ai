import {
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";
import type { OpenEmrResponse, Patient, SoapNote } from "@/lib/openemr/types";

function toErrorResponse(error: unknown) {
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
  return null;
}

// Fetch the SOAP note for one encounter, for the expandable encounter cards
// and the SOAP note editor artifact.
// GET /api/openemr/soap-note?puuid=<patient uuid>&eid=<encounter id>
// GET /api/openemr/soap-note?pid=<patient pid>&eid=<encounter id>
//
// OpenEMR's soap_note endpoint is keyed by the legacy numeric pid. The
// encounter cards only know the patient uuid from the getEncounters tool
// call, so the pid is resolved here first; callers that already hold the pid
// (the SOAP note editor) pass it directly.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");
  const eid = searchParams.get("eid");
  let pid = searchParams.get("pid");

  if (!(eid && (puuid || pid))) {
    return Response.json({ error: "missing_params" }, { status: 400 });
  }

  try {
    if (!pid && puuid) {
      const patient = await openemrFetch<OpenEmrResponse<Patient>>(
        `/api/patient/${encodeURIComponent(puuid)}`
      );
      pid = String(patient.data.pid);
    }
    const notes = await openemrFetch<SoapNote[]>(
      `/api/patient/${encodeURIComponent(String(pid))}/encounter/${encodeURIComponent(eid)}/soap_note`
    );
    return Response.json(notes[0] ?? null);
  } catch (error) {
    const response = toErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

// Update a SOAP note, for the SOAP note editor artifact.
// PUT /api/openemr/soap-note?pid=<pid>&eid=<encounter id>&sid=<note id>
// Body: { subjective, objective, assessment, plan }
export async function PUT(request: Request) {
  const { searchParams } = new URL(request.url);
  const pid = searchParams.get("pid");
  const eid = searchParams.get("eid");
  const sid = searchParams.get("sid");

  if (!(pid && eid && sid)) {
    return Response.json({ error: "missing_params" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const sections: Record<string, string> = {};
  for (const key of ["subjective", "objective", "assessment", "plan"]) {
    const value = body[key];
    sections[key] = typeof value === "string" ? value : "";
  }

  try {
    const updated = await openemrFetch(
      `/api/patient/${encodeURIComponent(pid)}/encounter/${encodeURIComponent(eid)}/soap_note/${encodeURIComponent(sid)}`,
      undefined,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sections),
      }
    );
    return Response.json(updated);
  } catch (error) {
    const response = toErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
