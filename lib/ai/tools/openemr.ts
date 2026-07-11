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
  MedicalIssue,
  OpenEmrResponse,
  Patient,
  SoapNote,
  Vital,
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

// OpenEMR serializes vitals measurements as decimal strings ("195.000000",
// "98.600000"); cast them to numbers (195, 98.6) — the padded precision is
// meaningless.
function toNumeric(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Trim the ~45-column vitals form down to the measurements themselves — ids,
// timestamps, and per-measurement `*_unit` columns are token noise the model
// doesn't need.
export type VitalSummary = ReturnType<typeof toVitalSummary>;

function toVitalSummary(vital: Vital) {
  return {
    date: vital.date,
    bps: toNumeric(vital.bps),
    bpd: toNumeric(vital.bpd),
    weight: toNumeric(vital.weight),
    height: toNumeric(vital.height),
    temperature: toNumeric(vital.temperature),
    pulse: toNumeric(vital.pulse),
    respiration: toNumeric(vital.respiration),
    oxygen_saturation: toNumeric(vital.oxygen_saturation),
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
  description:
    "Search for patients by name, or list all patients when no name is given.",
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

// Flatten the two `diagnosis` shapes OpenEMR sends (raw "ICD10:E11.9" string
// from the legacy list endpoints, code-keyed coding object from the
// medical_problem endpoint) into one uniform list of codes.
function toDiagnosisCodes(diagnosis: MedicalIssue["diagnosis"]) {
  if (!diagnosis) {
    return [];
  }
  if (typeof diagnosis === "string") {
    return diagnosis
      .split(";")
      .filter(Boolean)
      .map((code) => ({ code, description: null as string | null }));
  }
  return Object.values(diagnosis).map((coding) => ({
    code: coding.code_type ? `${coding.code_type}:${coding.code}` : coding.code,
    description: coding.description || null,
  }));
}

// Trim a lists-table entry down to what identifies the issue and its status —
// ids, audit columns, and injury/allergy-specific fields are token noise.
// `active` is derived: an issue with no end date is still ongoing.
export type MedicalIssueSummary = ReturnType<typeof toMedicalIssueSummary>;

function toMedicalIssueSummary(issue: MedicalIssue) {
  return {
    title: issue.title,
    begdate: issue.begdate,
    enddate: issue.enddate,
    active: !issue.enddate,
    diagnosis: toDiagnosisCodes(issue.diagnosis),
    comments: issue.comments,
  };
}

const issueListInputSchema = z.object({
  patient: patientRefSchema.describe(
    "The patient's `uuid`, `pid`, and `name`, from `searchPatients`."
  ),
});

export const getMedicalProblems = tool({
  description:
    "Retrieve a single patient's medical problem list (diagnoses/conditions), both active and resolved.",
  inputSchema: issueListInputSchema,
  execute: (input) =>
    withOpenEmrErrorHandling(async () => {
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
    execute: (input) =>
      withOpenEmrErrorHandling(async () => {
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
  execute: (input) =>
    withOpenEmrErrorHandling(async () => {
      const response = await openemrFetch<SoapNote[]>(
        `/api/patient/${input.pid}/encounter/${input.eid}/soap_note`
      );
      return response[0] ?? null;
    }),
});
