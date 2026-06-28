import {
  OpenEmrApiError,
  openemrFetch,
  OpenEmrNotConnectedError,
} from "@/lib/openemr/api";
import { tool } from "ai";
import { z } from "zod";

export const searchPatients = tool({
  description: "Search for patients by name.",
  inputSchema: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const data = await openemrFetch("/api/patient", {
        fname: input.firstName,
        lname: input.lastName,
      });
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

export const getEncounters = tool({
  description: "Retrieve encounters for a single patient.",
  inputSchema: z.object({
    patientUuid: z.string().uuid(),
  }),
  execute: async (input) => {
    try {
      const data = await openemrFetch(`/api/patient/${input.patientUuid}/encounter`);
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
