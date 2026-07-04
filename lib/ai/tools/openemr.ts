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

export const getEncounters = tool({
  description: "Retrieve encounters for a single patient.",
  inputSchema: z.object({
    puuid: z.string().uuid(),
  }),
  execute: (input) =>
    withOpenEmrErrorHandling(async () => {
      const response = await openemrFetch<OpenEmrResponse<Encounter[]>>(
        `/api/patient/${input.puuid}/encounter`
      );
      return response.data;
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
    pid: z.string(),
    eid: z.string(),
  }),
  execute: (input) =>
    withOpenEmrErrorHandling(async () => {
      const response = await openemrFetch<SoapNote[]>(
        `/api/patient/${input.pid}/encounter/${input.eid}/soap_note`
      );
      return response[0] ?? null;
    }),
});
