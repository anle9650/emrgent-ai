import { tool } from "ai";
import { z } from "zod";
import {
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";
import {
  type PatientSummary,
  toMedicalIssueSummary,
  toPatientSummary,
  toVitalSummary,
} from "@/lib/openemr/summaries";
import type {
  Appointment,
  Encounter,
  MedicalIssue,
  OpenEmrResponse,
  Patient,
  SoapNote,
  Vital,
} from "@/lib/openemr/types";

// The summary types originated here; re-exported so existing imports keep
// working after the massaging helpers moved to lib/openemr/summaries.ts.
export type {
  MedicalIssueSummary,
  PatientSummary,
  VitalSummary,
} from "@/lib/openemr/summaries";

// Every tool's execute() hits the OpenEMR API and needs the same fallback:
// report connection/API errors to the model instead of throwing. Successful
// results are stamped with the call's own toolCallId — providers don't
// reliably expose tool-call ids as model-visible text, so this is what lets
// the model bind `generateUI` domain cards to a result it has seen
// (`sourceToolCallId`).
async function withOpenEmrErrorHandling<T>(
  toolCallId: string,
  fn: () => Promise<T>
) {
  try {
    return { sourceToolCallId: toolCallId, results: await fn() };
  } catch (error) {
    if (error instanceof OpenEmrNotConnectedError) {
      return { error: "Not connected to OpenEMR." };
    }
    if (error instanceof OpenEmrApiError) {
      return { error: `OpenEMR API error: ${error.message}` };
    }
    throw error;
  }
}

export const searchPatients = tool({
  description:
    "Search for patients by name, or list all patients when no name is given.",
  inputSchema: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  }),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      const response = await openemrFetch<OpenEmrResponse<Patient[]>>(
        "/api/patient",
        {
          fname: input.firstName,
          lname: input.lastName,
        }
      );
      return response.data
        .sort(
          (a, b) =>
            a.fname.localeCompare(b.fname) || a.lname.localeCompare(b.lname)
        )
        .map(toPatientSummary);
    }),
});

// Just the identifiers the encounter/SOAP tools key off (plus `name` for
// display) — no need for the model to echo the rest of the `PatientSummary`.
// The `satisfies` check keeps the field types in sync with what
// `searchPatients` returns.
const patientRefSchema = z.object({
  uuid: z.string().uuid(),
  pid: z.number(),
  name: z.string(),
}) satisfies z.ZodType<Pick<PatientSummary, "uuid" | "pid" | "name">>;

export const getEncounters = tool({
  description:
    "Retrieve encounters for a single patient, each with its SOAP note and vitals when they exist, optionally limited to a date range (inclusive).",
  inputSchema: z.object({
    patient: patientRefSchema.describe(
      "The patient's `uuid`, `pid`, and `name`, from `searchPatients`."
    ),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
      .optional()
      .describe("Only include encounters on or after this date."),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
      .optional()
      .describe("Only include encounters on or before this date."),
  }),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      const response = await openemrFetch<OpenEmrResponse<Encounter[]>>(
        `/api/patient/${input.patient.uuid}/encounter`
      );
      // The endpoint has no date filters, so filter here. `date` may include a
      // time component, so compare only the YYYY-MM-DD prefix.
      const encounters = response.data.filter((encounter) => {
        const date = encounter.date.slice(0, 10);
        return (
          (!input.startDate || date >= input.startDate) &&
          (!input.endDate || date <= input.endDate)
        );
      });
      // Attach each encounter's SOAP note and vitals; the endpoints return an
      // empty array when the encounter has none.
      return await Promise.all(
        encounters.map(async (encounter) => {
          const [soapNotes, vitals] = await Promise.all([
            openemrFetch<SoapNote[]>(
              `/api/patient/${input.patient.pid}/encounter/${encounter.eid}/soap_note`
            ),
            openemrFetch<Vital[]>(
              `/api/patient/${input.patient.pid}/encounter/${encounter.eid}/vital`
            ),
          ]);
          return {
            ...encounter,
            soapNote: soapNotes[0] ?? null,
            vitals: vitals[0] ? toVitalSummary(vitals[0]) : null,
          };
        })
      );
    }),
});

export const getAppointments = tool({
  description:
    "Retrieve appointments, optionally filtered by patient ID, optionally limited to a date range (inclusive).",
  inputSchema: z.object({
    pid: z
      .number()
      .optional()
      .describe("Use `searchPatients` to find the patient's ID."),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
      .optional()
      .describe("Only include appointments on or after this date."),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
      .optional()
      .describe("Only include appointments on or before this date."),
  }),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      const path = input.pid
        ? `/api/patient/${input.pid}/appointment`
        : "/api/appointment";
      const response = await openemrFetch<Appointment[]>(path);
      // The endpoint has no date filters, so filter here. pc_eventDate is
      // YYYY-MM-DD, which compares correctly as a string.
      return response.filter(
        (appointment) =>
          (!input.startDate || appointment.pc_eventDate >= input.startDate) &&
          (!input.endDate || appointment.pc_eventDate <= input.endDate)
      );
    }),
});

const issueListInputSchema = z.object({
  patient: patientRefSchema.describe(
    "The patient's `uuid`, `pid`, and `name`, from `searchPatients`."
  ),
});

export const getMedicalProblems = tool({
  description:
    "Retrieve a single patient's medical problem list (diagnoses/conditions), both active and resolved.",
  inputSchema: issueListInputSchema,
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      const response = await openemrFetch<OpenEmrResponse<MedicalIssue[]>>(
        `/api/patient/${input.patient.uuid}/medical_problem`
      );
      return response.data.map(toMedicalIssueSummary);
    }),
});

// medication/surgery are served by OpenEMR's legacy ListRestController, which
// differs from the medical_problem endpoint on every axis: it's keyed by the
// numeric `pid` (not uuid), returns a bare array (no `{data}` envelope), and
// responds 404 with a null body when the patient has no entries — so a 404
// means an empty list, not a failure.
function createLegacyIssueListTool(path: string, description: string) {
  return tool({
    description,
    inputSchema: issueListInputSchema,
    execute: (input, { toolCallId }) =>
      withOpenEmrErrorHandling(toolCallId, async () => {
        try {
          const response = await openemrFetch<MedicalIssue[] | null>(
            `/api/patient/${input.patient.pid}/${path}`
          );
          return (response ?? []).map(toMedicalIssueSummary);
        } catch (error) {
          if (error instanceof OpenEmrApiError && error.status === 404) {
            return [];
          }
          throw error;
        }
      }),
  });
}

export const getMedications = createLegacyIssueListTool(
  "medication",
  "Retrieve a single patient's medication list, both active and discontinued."
);

export const getSurgeries = createLegacyIssueListTool(
  "surgery",
  "Retrieve a single patient's surgical history."
);

export const getSoapNote = tool({
  description: "Retrieve SOAP note for a single patient encounter.",
  inputSchema: z.object({
    pid: z.number().describe("Use `searchPatients` to find the patient's ID."),
    eid: z.number().describe("Use `getEncounters` to find the encounter ID."),
  }),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      const response = await openemrFetch<SoapNote[]>(
        `/api/patient/${input.pid}/encounter/${input.eid}/soap_note`
      );
      return response[0] ?? null;
    }),
});
