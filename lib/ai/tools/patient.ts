import {
  OpenEmrApiError,
  openemrFetch,
  OpenEmrNotConnectedError,
} from "@/lib/openemr/api";
import type { OpenEmrResponse, Patient } from "@/lib/openemr/types";
import { tool } from "ai";
import { z } from "zod";

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

export const searchPatients = tool({
  description: "Search for patients by name.",
  inputSchema: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const response = await openemrFetch<OpenEmrResponse<Patient[]>>(
        "/api/patient",
        {
          fname: input.firstName,
          lname: input.lastName,
        },
      );
      return response.data.map(toPatientSummary);
    } catch (error) {
      if (error instanceof OpenEmrNotConnectedError) {
        return {
          error: "Not connected to OpenEMR.",
        };
      }
      if (error instanceof OpenEmrApiError) {
        return {
          error: `OpenEMR API error: ${error.message}`,
        };
      }
      throw error;
    }
  },
});

export const getEncounters = tool({
  description: "Retrieve encounters for a single patient.",
  inputSchema: z.object({
    puuid: z.string().uuid(),
  }),
  execute: async (input) => {
    try {
      const data = await openemrFetch(`/api/patient/${input.puuid}/encounter`);
      return data;
    } catch (error) {
      if (error instanceof OpenEmrNotConnectedError) {
        return {
          error: "Not connected to OpenEMR.",
        };
      }
      if (error instanceof OpenEmrApiError) {
        return {
          error: `OpenEMR API error: ${error.message}`,
        };
      }
      throw error;
    }
  },
});

export const getSoapNote = tool({
  description: "Retrieve SOAP note for a single patient encounter.",
  inputSchema: z.object({
    pid: z.string(),
    eid: z.string(),
  }),
  execute: async (input) => {
    try {
      const data = await openemrFetch(
        `/api/patient/${input.pid}/encounter/${input.eid}/soap_note`,
      );
      return data;
    } catch (error) {
      if (error instanceof OpenEmrNotConnectedError) {
        return {
          error: "Not connected to OpenEMR.",
        };
      }
      if (error instanceof OpenEmrApiError) {
        return {
          error: `OpenEMR API error: ${error.message}`,
        };
      }
      throw error;
    }
  },
});
