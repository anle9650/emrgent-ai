import { tool } from "ai";
import { z } from "zod";
import {
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";
import type {
  Appointment,
  Encounter,
  OpenEmrResponse,
  Patient,
  SoapNote,
} from "@/lib/openemr/types";

// Trim the ~150-field OpenEMR record down to what's useful for identifying and
// disambiguating a patient in search results. Keeps token cost low and avoids
// exposing PHI (SSN, license, guardian details, HIPAA flags) the model doesn't
// need. `uuid`/`pid` are retained because the encounter/SOAP tools key off them.
export type PatientSummary = ReturnType<typeof toPatientSummary>;

function toPatientSummary(patient: Patient) {
  return {
    uuid: patient.uuid,
    pid: patient.pid,
    pubpid: patient.pubpid,
    name: [patient.title, patient.fname, patient.mname, patient.lname]
      .filter(Boolean)
      .join(" "),
    DOB: patient.DOB,
    sex: patient.sex,
    status: patient.status,
    phone: patient.phone_cell || patient.phone_home,
    email: patient.email,
    city: patient.city,
    state: patient.state,
  };
}

// Every tool's execute() hits the OpenEMR API and needs the same fallback:
// report connection/API errors to the model instead of throwing.
async function withOpenEmrErrorHandling<T>(fn: () => Promise<T>) {
  try {
    return await fn();
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
  description: "Search for patients by name.",
  inputSchema: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  }),
  execute: (input) =>
    withOpenEmrErrorHandling(async () => {
      const response = await openemrFetch<OpenEmrResponse<Patient[]>>(
        "/api/patient",
        {
          fname: input.firstName,
          lname: input.lastName,
        }
      );
      return response.data.map(toPatientSummary);
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
    "Retrieve encounters for a single patient, each with its SOAP note when one exists, optionally limited to a date range (inclusive).",
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
  execute: (input) =>
    withOpenEmrErrorHandling(async () => {
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
      // Attach each encounter's SOAP note; the endpoint returns an empty
      // array when the encounter has none.
      return await Promise.all(
        encounters.map(async (encounter) => {
          const soapNotes = await openemrFetch<SoapNote[]>(
            `/api/patient/${input.patient.pid}/encounter/${encounter.eid}/soap_note`
          );
          return { ...encounter, soapNote: soapNotes[0] ?? null };
        })
      );
    }),
});

export const getAppointments = tool({
  description:
    "Retrieve appointments, optionally limited to a date range (inclusive).",
  inputSchema: z.object({
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
  execute: (input) =>
    withOpenEmrErrorHandling(async () => {
      const response = await openemrFetch<Appointment[]>("/api/appointment");
      // The endpoint has no date filters, so filter here. pc_eventDate is
      // YYYY-MM-DD, which compares correctly as a string.
      return response.filter(
        (appointment) =>
          (!input.startDate || appointment.pc_eventDate >= input.startDate) &&
          (!input.endDate || appointment.pc_eventDate <= input.endDate)
      );
    }),
});

export const getSoapNote = tool({
  description: "Retrieve SOAP note for a single patient encounter.",
  inputSchema: z.object({
    pid: z.number().describe("Use `searchPatients` to find the patient's ID."),
    eid: z.number().describe("Use `getEncounters` to find the encounter ID."),
  }),
  execute: (input) =>
    withOpenEmrErrorHandling(async () => {
      const response = await openemrFetch<SoapNote[]>(
        `/api/patient/${input.pid}/encounter/${input.eid}/soap_note`
      );
      return response[0] ?? null;
    }),
});
