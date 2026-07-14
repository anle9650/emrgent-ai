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
      return {
        error:
          "Not connected to OpenEMR. The user needs to sign in via OpenEMR (sign out first if already signed in) to restore the connection.",
      };
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

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const vitalsInputSchema = z.object({
  bps: z.number().optional().describe("Systolic blood pressure (mmHg)."),
  bpd: z.number().optional().describe("Diastolic blood pressure (mmHg)."),
  weight: z.number().optional().describe("Weight (lb)."),
  height: z.number().optional().describe("Height (in)."),
  temperature: z.number().optional().describe("Temperature (°F)."),
  pulse: z.number().optional().describe("Pulse (bpm)."),
  respiration: z.number().optional().describe("Respiration (breaths/min)."),
  oxygenSaturation: z.number().optional().describe("Oxygen saturation (%)."),
});

const soapNoteInputSchema = z.object({
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.string().optional(),
});

const jsonPost = (body: Record<string, unknown>) =>
  ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as const;

// OpenEMR reports request-validation failures inside a 2xx envelope — the
// HTTP status alone doesn't mean the write happened. A non-empty
// validationErrors (object keyed by field, or array) means nothing was saved.
function assertNoValidationErrors(response: OpenEmrResponse<unknown>) {
  const errors = response.validationErrors;
  const isEmpty = Array.isArray(errors)
    ? errors.length === 0
    : !errors || Object.keys(errors).length === 0;
  if (!isEmpty) {
    throw new OpenEmrApiError(422, JSON.stringify(errors).slice(0, 300));
  }
}

// The legacy vital endpoint expects measurements as decimal strings.
const toVitalsBody = (vitals: z.infer<typeof vitalsInputSchema>) =>
  Object.fromEntries(
    Object.entries({
      bps: vitals.bps,
      bpd: vitals.bpd,
      weight: vitals.weight,
      height: vitals.height,
      temperature: vitals.temperature,
      pulse: vitals.pulse,
      respiration: vitals.respiration,
      oxygen_saturation: vitals.oxygenSaturation,
    })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)])
  );

// Attachment POSTs run after the encounter exists, so an API failure must not
// discard the created encounter — report it per attachment instead. Connection
// errors still bubble to withOpenEmrErrorHandling.
async function saveAttachment(fn: () => Promise<unknown>) {
  try {
    await fn();
    return "saved" as const;
  } catch (error) {
    if (error instanceof OpenEmrApiError) {
      return { error: `OpenEMR API error: ${error.message}` };
    }
    throw error;
  }
}

export const createEncounter = tool({
  description:
    "Create a new encounter for a patient in OpenEMR, optionally recording vitals and a SOAP note on it. Requires user approval before it runs.",
  inputSchema: z.object({
    patient: patientRefSchema.describe(
      "The patient's `uuid`, `pid`, and `name`, from `searchPatients`."
    ),
    reason: z.string().describe("Visit reason / chief complaint."),
    date: dateSchema
      .optional()
      .describe("Encounter date; defaults to today when omitted."),
    vitals: vitalsInputSchema
      .optional()
      .describe("Vital signs to record on the new encounter."),
    soapNote: soapNoteInputSchema
      .optional()
      .describe("SOAP note to attach to the new encounter."),
  }),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      const date = input.date ?? new Date().toISOString().slice(0, 10);
      // Depending on the OpenEMR version, `data` is `{encounter, uuid}`, the
      // full encounter record (`eid`/`euuid` keys), a one-element list of
      // either, or even [] when the post-insert re-fetch found nothing.
      type CreatedEncounter = {
        encounter?: number | string;
        eid?: number | string;
        uuid?: string;
        euuid?: string;
      };
      const created = await openemrFetch<
        OpenEmrResponse<CreatedEncounter | CreatedEncounter[]>
      >(
        `/api/patient/${input.patient.uuid}/encounter`,
        undefined,
        jsonPost({
          date,
          reason: input.reason,
          // 5 = "Office Visit" in OpenEMR's default seed data; the validator
          // requires the id, not the name.
          pc_catid: "5",
          pc_catname: "Office Visit",
          class_code: "AMB",
        })
      );
      assertNoValidationErrors(created);
      const row = Array.isArray(created.data) ? created.data[0] : created.data;
      const eid = Number(row?.encounter ?? row?.eid);

      // A 2xx means the encounter exists, but without its id we can't attach
      // anything to it — and a NaN eid must never reach the result, because
      // it fails message validation on the next model call and bricks the
      // whole conversation.
      if (!Number.isFinite(eid)) {
        return {
          encounterCreated: true,
          eid: null,
          euuid: row?.uuid ?? row?.euuid ?? null,
          date,
          reason: input.reason,
          warning: `OpenEMR did not return the new encounter's id${
            input.vitals || input.soapNote
              ? ", so the vitals/SOAP note could NOT be attached — the user can add them in OpenEMR directly"
              : ""
          }. Raw response: ${JSON.stringify(created).slice(0, 400)}`,
        };
      }

      const base = `/api/patient/${input.patient.pid}/encounter/${eid}`;

      const vitalsInput = input.vitals;
      const vitals =
        vitalsInput &&
        (await saveAttachment(() =>
          openemrFetch(
            `${base}/vital`,
            undefined,
            jsonPost(toVitalsBody(vitalsInput))
          )
        ));

      const soapNote =
        input.soapNote &&
        (await saveAttachment(() =>
          openemrFetch(
            `${base}/soap_note`,
            undefined,
            jsonPost({
              subjective: input.soapNote?.subjective ?? "",
              objective: input.soapNote?.objective ?? "",
              assessment: input.soapNote?.assessment ?? "",
              plan: input.soapNote?.plan ?? "",
            })
          )
        ));

      return {
        eid,
        euuid: row?.uuid ?? row?.euuid ?? null,
        date,
        reason: input.reason,
        ...(vitals && { vitals }),
        ...(soapNote && { soapNote }),
      };
    }),
});

export const createMedicalProblem = tool({
  description:
    "Add a medical problem (diagnosis/condition) to a patient's problem list in OpenEMR. Requires user approval before it runs.",
  inputSchema: z.object({
    patient: patientRefSchema.describe(
      "The patient's `uuid`, `pid`, and `name`, from `searchPatients`."
    ),
    title: z.string().describe('Name of the problem, e.g. "Dermatochalasis".'),
    begdate: dateSchema
      .optional()
      .describe("Onset date; defaults to today when omitted."),
    enddate: dateSchema
      .optional()
      .describe("Resolution date; omit for an active problem."),
    diagnosis: z
      .string()
      .optional()
      .describe('Coded diagnosis, e.g. "ICD10:H02.839".'),
  }),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      const begdate = input.begdate ?? new Date().toISOString().slice(0, 10);
      const created = await openemrFetch<
        OpenEmrResponse<MedicalIssue | MedicalIssue[]>
      >(
        `/api/patient/${input.patient.uuid}/medical_problem`,
        undefined,
        jsonPost({
          title: input.title,
          begdate,
          enddate: input.enddate ?? null,
          diagnosis: input.diagnosis ?? "",
        })
      );
      assertNoValidationErrors(created);
      // Echo what was written rather than trusting the response shape —
      // createEncounter shows it varies across OpenEMR versions.
      return {
        title: input.title,
        begdate,
        enddate: input.enddate ?? null,
        diagnosis: input.diagnosis ?? null,
      };
    }),
});

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
