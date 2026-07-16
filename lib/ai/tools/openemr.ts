import { tool } from "ai";
import { z } from "zod";
import {
  OpenEmrApiError,
  OpenEmrNotConnectedError,
  openemrFetch,
} from "@/lib/openemr/api";
import {
  type MedicalProblemSummary,
  type MedicationSummary,
  type PatientSummary,
  toMedicalIssueSummary,
  toMedicalProblemSummary,
  toMedicationSummary,
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

// The per-encounter soap_note/vital endpoints are legacy ones that respond
// 404 with a null body when the encounter has no entries — map that to an
// empty list instead of failing (same convention as medication/surgery).
async function fetchEncounterAttachment<T>(path: string): Promise<T[]> {
  try {
    return (await openemrFetch<T[] | null>(path)) ?? [];
  } catch (error) {
    if (error instanceof OpenEmrApiError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

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
      // Attach each encounter's SOAP note and vitals. These are legacy
      // endpoints that respond 404 with a null body when the encounter has
      // none (like medication/surgery below), so a 404 means an empty list —
      // it must not fail the whole tool call.
      return await Promise.all(
        encounters.map(async (encounter) => {
          const [soapNotes, vitals] = await Promise.all([
            fetchEncounterAttachment<SoapNote>(
              `/api/patient/${input.patient.pid}/encounter/${encounter.eid}/soap_note`
            ),
            fetchEncounterAttachment<Vital>(
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
      return response.data.map(toMedicalProblemSummary);
    }),
});

// medication/surgery are served by OpenEMR's legacy ListRestController, which
// differs from the medical_problem endpoint on every axis: it's keyed by the
// numeric `pid` (not uuid), returns a bare array (no `{data}` envelope), and
// responds 404 with a null body when the patient has no entries — so a 404
// means an empty list, not a failure.
function createLegacyIssueListTool<T>(
  path: string,
  description: string,
  map: (issue: MedicalIssue) => T
) {
  return tool({
    description,
    inputSchema: issueListInputSchema,
    execute: (input, { toolCallId }) =>
      withOpenEmrErrorHandling(toolCallId, async () => {
        try {
          const response = await openemrFetch<MedicalIssue[] | null>(
            `/api/patient/${input.patient.pid}/${path}`
          );
          return (response ?? []).map(map);
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
  "Retrieve a single patient's medication list, both active and discontinued.",
  toMedicationSummary
);

export const getSurgeries = createLegacyIssueListTool(
  "surgery",
  "Retrieve a single patient's surgical history.",
  toMedicalIssueSummary
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

const jsonRequest = (method: "POST" | "PUT", body: Record<string, unknown>) =>
  ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as const;

const jsonPost = (body: Record<string, unknown>) => jsonRequest("POST", body);

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
      // createEncounter shows it varies across OpenEMR versions. `uuid` is
      // the exception: it only exists in the response, and returning it lets
      // the model chain into `updateMedicalProblem` without a re-fetch.
      const row = Array.isArray(created.data) ? created.data[0] : created.data;
      return {
        uuid: row?.uuid ?? null,
        title: input.title,
        begdate,
        enddate: input.enddate ?? null,
        diagnosis: input.diagnosis ?? null,
      };
    }),
});

// The problem's current summary, echoed from `getMedicalProblems` like
// `patientRefSchema` is from `searchPatients`. `uuid` addresses the problem
// in the PUT path; the rest exists so the approval card can preview the
// finalized record, not just the changed fields. It is NEVER merged into the
// PUT body — that's built exclusively from the explicit change fields, so a
// summary the model mis-copied can't be written back to OpenEMR.
const problemRefSchema = z.object({
  uuid: z.string().uuid(),
  title: z.string(),
  begdate: z.string().nullable(),
  enddate: z.string().nullable(),
  diagnosis: z.array(
    z.object({ code: z.string(), description: z.string().nullable() })
  ),
}) satisfies z.ZodType<
  Pick<
    MedicalProblemSummary,
    "uuid" | "title" | "begdate" | "enddate" | "diagnosis"
  >
>;

export const updateMedicalProblem = tool({
  description:
    "Update an existing medical problem on a patient's problem list in OpenEMR — correct its details, mark it resolved, or reactivate it. Requires user approval before it runs.",
  inputSchema: z
    .object({
      patient: patientRefSchema.describe(
        "The patient's `uuid`, `pid`, and `name`, from `searchPatients`."
      ),
      problem: problemRefSchema.describe(
        "The problem's current summary, copied verbatim from `getMedicalProblems`."
      ),
      title: z
        .string()
        .optional()
        .describe("New title; omit to leave unchanged."),
      begdate: dateSchema
        .optional()
        .describe("New onset date; omit to leave unchanged."),
      enddate: dateSchema
        .nullable()
        .optional()
        .describe(
          "Resolution date; pass null to mark the problem active again; omit to leave unchanged."
        ),
      diagnosis: z
        .string()
        .optional()
        .describe(
          'New coded diagnosis, e.g. "ICD10:H02.839"; omit to leave unchanged.'
        ),
    })
    .refine(
      (value) =>
        value.title !== undefined ||
        value.begdate !== undefined ||
        value.enddate !== undefined ||
        value.diagnosis !== undefined,
      { message: "Pass at least one field to change." }
    ),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      // Send only the changed fields so omitted ones aren't clobbered; an
      // explicit `enddate: null` IS sent — it clears the resolution date.
      const body: Record<string, unknown> = {};
      if (input.title !== undefined) {
        body.title = input.title;
      }
      if (input.begdate !== undefined) {
        body.begdate = input.begdate;
      }
      if (input.enddate !== undefined) {
        body.enddate = input.enddate;
      }
      if (input.diagnosis !== undefined) {
        body.diagnosis = input.diagnosis;
      }
      const updated = await openemrFetch<OpenEmrResponse<unknown>>(
        `/api/patient/${input.patient.uuid}/medical_problem/${input.problem.uuid}`,
        undefined,
        jsonRequest("PUT", body)
      );
      assertNoValidationErrors(updated);
      // Echo what was written rather than trusting the response shape —
      // createEncounter shows it varies across OpenEMR versions.
      return { uuid: input.problem.uuid, ...body };
    }),
});

// The legacy write responses vary like the create-encounter ones do — an
// envelope, a bare row, or a one-element list of either. Pull the row's
// numeric id out defensively; null when it can't be found.
function extractLegacyRowId(response: unknown): number | null {
  const data =
    response && typeof response === "object" && "data" in response
      ? (response as OpenEmrResponse<unknown>).data
      : response;
  const row = Array.isArray(data) ? data[0] : data;
  const id = Number((row as { id?: number | string } | null)?.id);
  return Number.isFinite(id) ? id : null;
}

// A failed legacy (ListRestController) validation comes back 2xx with the
// bare field->messages object — no envelope, no `validationErrors` key, no
// `id` — so `assertNoValidationErrors` can't see it and the write silently
// never happened. A genuine success is always `{id: ...}`; treat anything
// else as a validation failure and surface the body.
function assertLegacyWriteSucceeded(response: unknown): number {
  const id = extractLegacyRowId(response);
  if (id === null) {
    throw new OpenEmrApiError(422, JSON.stringify(response).slice(0, 300));
  }
  return id;
}

// The legacy list validator only accepts `Y-m-d H:i:s` datetimes — a bare
// date fails validation (rejecting the whole write) — so pad dates with
// midnight before sending.
const toLegacyDateTime = (date: string | null) =>
  date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date} 00:00:00` : date;

export const createMedication = tool({
  description:
    "Add a medication to a patient's medication list in OpenEMR. Requires user approval before it runs.",
  inputSchema: z.object({
    patient: patientRefSchema.describe(
      "The patient's `uuid`, `pid`, and `name`, from `searchPatients`."
    ),
    title: z.string().describe('Name of the medication, e.g. "Norvasc".'),
    begdate: dateSchema
      .optional()
      .describe("Start date; defaults to today when omitted."),
    enddate: dateSchema
      .optional()
      .describe("Discontinuation date; omit for an active medication."),
  }),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      const begdate = input.begdate ?? new Date().toISOString().slice(0, 10);
      const created = await openemrFetch<OpenEmrResponse<unknown> | null>(
        `/api/patient/${input.patient.pid}/medication`,
        undefined,
        jsonPost({
          title: input.title,
          begdate: toLegacyDateTime(begdate),
          enddate: toLegacyDateTime(input.enddate ?? null),
        })
      );
      // Echo what was written rather than trusting the response shape —
      // createEncounter shows it varies across OpenEMR versions. `id` is the
      // exception: it only exists in the response, and returning it lets the
      // model chain into `updateMedication` without a re-fetch.
      return {
        id: assertLegacyWriteSucceeded(created),
        title: input.title,
        begdate,
        enddate: input.enddate ?? null,
      };
    }),
});

// The medication's current summary, echoed from `getMedications` like
// `problemRefSchema` is from `getMedicalProblems`. `id` addresses the row in
// the PUT path (the legacy ListRestController keys by the numeric lists-table
// id, not a uuid). Unlike the medical_problem PUT (a partial update), the
// legacy PUT is a full-row UPDATE — title/begdate/enddate/diagnosis are all
// SET unconditionally and `title` is required — so the unchanged fields of
// the body are filled from this summary. The approval card previews exactly
// that merged record, so the user reviews what will actually be written.
const medicationRefSchema = z.object({
  id: z.number(),
  title: z.string(),
  begdate: z.string().nullable(),
  enddate: z.string().nullable(),
  diagnosis: z.array(
    z.object({ code: z.string(), description: z.string().nullable() })
  ),
}) satisfies z.ZodType<
  Pick<MedicationSummary, "id" | "title" | "begdate" | "enddate" | "diagnosis">
>;

export const updateMedication = tool({
  description:
    "Update an existing medication on a patient's medication list in OpenEMR — correct its details, discontinue it, or reactivate it. Requires user approval before it runs.",
  inputSchema: z
    .object({
      patient: patientRefSchema.describe(
        "The patient's `uuid`, `pid`, and `name`, from `searchPatients`."
      ),
      medication: medicationRefSchema.describe(
        "The medication's current summary, copied verbatim from `getMedications`."
      ),
      title: z
        .string()
        .optional()
        .describe("New title; omit to leave unchanged."),
      begdate: dateSchema
        .optional()
        .describe("New start date; omit to leave unchanged."),
      enddate: dateSchema
        .nullable()
        .optional()
        .describe(
          "Discontinuation date; pass null to mark the medication active again; omit to leave unchanged."
        ),
    })
    .refine(
      (value) =>
        value.title !== undefined ||
        value.begdate !== undefined ||
        value.enddate !== undefined,
      { message: "Pass at least one field to change." }
    ),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      // The legacy PUT is a full-row UPDATE (see medicationRefSchema), so the
      // body carries the complete finalized record: changed fields over the
      // echoed current summary — with `enddate: null` explicitly clearing the
      // discontinuation date, and the diagnosis reconstructed into its raw
      // semicolon-joined form so it isn't NULL-clobbered.
      const title = input.title ?? input.medication.title;
      const begdate = input.begdate ?? input.medication.begdate;
      const enddate =
        input.enddate === undefined ? input.medication.enddate : input.enddate;
      const diagnosis =
        input.medication.diagnosis.map(({ code }) => code).join(";") || null;
      const updated = await openemrFetch<OpenEmrResponse<unknown> | null>(
        `/api/patient/${input.patient.pid}/medication/${input.medication.id}`,
        undefined,
        jsonRequest("PUT", {
          title,
          begdate: toLegacyDateTime(begdate),
          enddate: toLegacyDateTime(enddate),
          diagnosis,
        })
      );
      assertLegacyWriteSucceeded(updated);
      // Echo what was written rather than trusting the response shape —
      // createEncounter shows it varies across OpenEMR versions.
      return { id: input.medication.id, title, begdate, enddate, diagnosis };
    }),
});

export const createSurgery = tool({
  description:
    "Record a surgery in a patient's surgical history in OpenEMR. Requires user approval before it runs.",
  inputSchema: z.object({
    patient: patientRefSchema.describe(
      "The patient's `uuid`, `pid`, and `name`, from `searchPatients`."
    ),
    title: z.string().describe('Name of the surgery, e.g. "Blepharoplasty".'),
    begdate: dateSchema
      .optional()
      .describe("Date of the surgery; defaults to today when omitted."),
    enddate: dateSchema
      .optional()
      .describe("End date, for multi-day procedures; usually omitted."),
    diagnosis: z
      .string()
      .optional()
      .describe('Coded procedure, e.g. "CPT4:15823-50".'),
  }),
  execute: (input, { toolCallId }) =>
    withOpenEmrErrorHandling(toolCallId, async () => {
      const begdate = input.begdate ?? new Date().toISOString().slice(0, 10);
      const created = await openemrFetch<OpenEmrResponse<unknown> | null>(
        `/api/patient/${input.patient.pid}/surgery`,
        undefined,
        jsonPost({
          title: input.title,
          begdate: toLegacyDateTime(begdate),
          enddate: toLegacyDateTime(input.enddate ?? null),
          diagnosis: input.diagnosis ?? null,
        })
      );
      return {
        id: assertLegacyWriteSucceeded(created),
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
