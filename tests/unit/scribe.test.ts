import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { pickRecorderMimeType } from "@/hooks/use-encounter-recorder";
import { chunksForPrompt } from "@/lib/ai/models.mock";
import {
  buildScribeKickoffMessage,
  parseScribeKickoff,
  readScribeChartState,
  SCRIBE_SESSION_HEADER,
  SCRIBE_TRANSCRIPT_MARKER,
  selectionFromAppointment,
  selectionFromPatient,
} from "@/lib/ai/scribe";
import type { Appointment } from "@/lib/openemr/types";

const PATIENT = {
  uuid: "11111111-1111-4111-8111-111111111111",
  pid: 1,
  name: "Eleanor Vance",
  DOB: "1948-03-12",
  sex: "Female",
  pubpid: "PV-001",
};

const APPOINTMENT: Appointment = {
  pc_eid: "300",
  pc_uuid: "33333333-3333-4333-8333-333333333300",
  fname: "Eleanor",
  lname: "Vance",
  DOB: "1948-03-12",
  pid: "1",
  puuid: PATIENT.uuid,
  pce_aid_uuid: "44444444-4444-4444-8444-444444444444",
  pce_aid_fname: "Susan",
  pce_aid_lname: "Reyes",
  pce_aid_npi: null,
  pc_apptstatus: "@",
  pc_eventDate: "2026-07-14",
  pc_startTime: "08:30:00",
  pc_endTime: "09:00:00",
  pc_time: "2026-07-07 09:55:00",
  pc_title: "Hypertension Check",
  facility_name: "Harbor Family Practice",
};

const VISIT_DATE = "2026-07-15";

describe("buildScribeKickoffMessage", () => {
  test("includes header with patient identifiers, visit date, appointment, and transcript", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromAppointment(APPOINTMENT),
      transcript: "BP 132 over 84.",
      visitDate: VISIT_DATE,
    });
    assert.ok(
      message.startsWith(
        `${SCRIBE_SESSION_HEADER} Eleanor Vance (uuid: ${PATIENT.uuid}, pid: 1).`
      )
    );
    assert.match(message, /Visit date: 2026-07-15\./);
    assert.match(message, /Appointment: Hypertension Check on 2026-07-14/);
    assert.ok(message.includes(SCRIBE_TRANSCRIPT_MARKER));
    assert.ok(message.endsWith("BP 132 over 84."));
  });

  test("omits the appointment line for a patient-only selection", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "Transcript body.",
      visitDate: VISIT_DATE,
    });
    assert.doesNotMatch(message, /Appointment:/);
    assert.ok(message.includes(SCRIBE_TRANSCRIPT_MARKER));
  });
});

describe("selection demographics for the overview chart", () => {
  test("patient selection carries DOB, sex, and pubpid", () => {
    const { patient } = selectionFromPatient(PATIENT);
    assert.equal(patient.DOB, "1948-03-12");
    assert.equal(patient.sex, "Female");
    assert.equal(patient.pubpid, "PV-001");
  });

  test("appointment selection carries DOB (the only demographic the join has)", () => {
    const { patient } = selectionFromAppointment(APPOINTMENT);
    assert.equal(patient.DOB, "1948-03-12");
    assert.equal(patient.sex, undefined);
    assert.equal(patient.pubpid, undefined);
  });
});

describe("parseScribeKickoff round-trip", () => {
  test("recovers name, visit date, appointment title, and transcript from an appointment kickoff", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromAppointment(APPOINTMENT),
      transcript: "BP 132 over 84.\n\nContinue lisinopril.",
      visitDate: VISIT_DATE,
    });
    const parsed = parseScribeKickoff(message);
    assert.equal(parsed.patientName, "Eleanor Vance");
    assert.equal(parsed.uuid, PATIENT.uuid);
    assert.equal(parsed.pid, 1);
    assert.equal(parsed.visitDate, VISIT_DATE);
    assert.equal(parsed.appointmentTitle, "Hypertension Check");
    assert.equal(parsed.transcript, "BP 132 over 84.\n\nContinue lisinopril.");
  });

  test("recovers name, visit date, and transcript, with null appointment, for a patient-only kickoff", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "Transcript body.",
      visitDate: VISIT_DATE,
    });
    const parsed = parseScribeKickoff(message);
    assert.equal(parsed.patientName, "Eleanor Vance");
    assert.equal(parsed.visitDate, VISIT_DATE);
    assert.equal(parsed.appointmentTitle, null);
    assert.equal(parsed.transcript, "Transcript body.");
  });

  test("returns null visit date for a message saved before the date was baked in", () => {
    const legacy = `${SCRIBE_SESSION_HEADER} Eleanor Vance (uuid: ${PATIENT.uuid}, pid: 1).\n\n${SCRIBE_TRANSCRIPT_MARKER}\n\nBody.`;
    assert.equal(parseScribeKickoff(legacy).visitDate, null);
  });
});

describe("readScribeChartState", () => {
  const kickoff = () =>
    buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "Body.",
      visitDate: VISIT_DATE,
    });
  const userMsg = (text: string) => ({
    role: "user",
    parts: [{ type: "text", text }],
  });

  test("reports the patient and a completed encounter once the turn is settled", () => {
    const state = readScribeChartState([
      userMsg(kickoff()),
      {
        role: "assistant",
        parts: [
          {
            type: "tool-createEncounter",
            state: "output-available",
            toolCallId: "enc-1",
            output: { sourceToolCallId: "enc-1", results: { eid: 901 } },
          },
          { type: "text", text: "Charted the encounter." },
        ],
      },
    ]);
    assert.ok(state);
    assert.equal(state?.patient.uuid, PATIENT.uuid);
    assert.equal(state?.patient.pid, 1);
    assert.deepEqual(state?.completedEncounterIds, ["enc-1"]);
    assert.equal(state?.hasPendingTool, false);
  });

  test("flags a pending tool while createEncounter awaits approval", () => {
    const state = readScribeChartState([
      userMsg(kickoff()),
      {
        role: "assistant",
        parts: [
          {
            type: "tool-createEncounter",
            state: "approval-requested",
            toolCallId: "enc-1",
          },
        ],
      },
    ]);
    assert.equal(state?.hasPendingTool, true);
    assert.deepEqual(state?.completedEncounterIds, []);
  });

  test("does not count an encounter whose write errored", () => {
    const state = readScribeChartState([
      userMsg(kickoff()),
      {
        role: "assistant",
        parts: [
          {
            type: "tool-createEncounter",
            state: "output-available",
            toolCallId: "enc-1",
            output: { error: "OpenEMR API error" },
          },
        ],
      },
    ]);
    assert.deepEqual(state?.completedEncounterIds, []);
    assert.equal(state?.hasPendingTool, false);
  });

  test("returns null for a non-scribe chat", () => {
    assert.equal(
      readScribeChartState([userMsg("just a normal question")]),
      null
    );
  });
});

describe("pickRecorderMimeType", () => {
  test("prefers webm+opus, then webm, then mp4", () => {
    assert.equal(
      pickRecorderMimeType(() => true),
      "audio/webm;codecs=opus"
    );
    assert.equal(
      pickRecorderMimeType((type) => !type.includes("opus")),
      "audio/webm"
    );
    assert.equal(
      pickRecorderMimeType((type) => type === "audio/mp4"),
      "audio/mp4"
    );
    assert.equal(
      pickRecorderMimeType(() => false),
      undefined
    );
  });
});

// --- mock scribe script ------------------------------------------------

const SYSTEM = {
  role: "system",
  content: "You help clinicians look up patient charts and appointments.",
} as const;

function user(text: string): LanguageModelV3Prompt[number] {
  return { role: "user", content: [{ type: "text", text }] };
}

function toolResult(
  toolCallId: string,
  toolName: string,
  value: unknown
): LanguageModelV3Prompt[number] {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "json", value: value as never },
      },
    ],
  };
}

function toolCallOf(chunks: LanguageModelV3StreamPart[]) {
  return chunks.find((chunk) => chunk.type === "tool-call");
}

const KICKOFF = user(
  buildScribeKickoffMessage({
    ...selectionFromPatient(PATIENT),
    transcript: "BP 132 over 84. Continue lisinopril.",
    visitDate: VISIT_DATE,
  })
);

describe("mock scribe script", () => {
  test("step 1: kickoff message emits getMedicalProblems with the parsed patient", () => {
    const chunks = chunksForPrompt([SYSTEM, KICKOFF]);
    const call = toolCallOf(chunks);
    assert.equal(call?.toolName, "getMedicalProblems");
    assert.ok(call?.input.includes(PATIENT.uuid));
    assert.ok(call?.input.includes('"pid":1'));
  });

  test("step 2 (no problems): emits only createEncounter with vitals and SOAP note", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      KICKOFF,
      toolResult("abc", "getMedicalProblems", {
        sourceToolCallId: "abc",
        results: [],
      }),
    ]);
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "createEncounter");
    assert.ok(calls[0]?.input.includes('"vitals"'));
    assert.ok(calls[0]?.input.includes('"soapNote"'));
  });

  test("step 2 (existing problem): emits updateMedicalProblem AND createEncounter in one step", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      KICKOFF,
      toolResult("abc", "getMedicalProblems", {
        sourceToolCallId: "abc",
        results: [
          {
            uuid: "66666666-6666-4666-8666-666666666601",
            title: "Type 2 Diabetes Mellitus",
            begdate: "2015-06-01",
            enddate: null,
            active: true,
            diagnosis: [{ code: "ICD10:E11.9", description: null }],
            comments: "Managed with metformin.",
          },
        ],
      }),
    ]);
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.deepEqual(
      calls.map((call) => call.toolName),
      ["updateMedicalProblem", "createEncounter"]
    );
    // The problem ref is copied verbatim from the result.
    const updateInput = JSON.parse(calls[0]?.input ?? "{}");
    assert.equal(
      updateInput.problem.uuid,
      "66666666-6666-4666-8666-666666666601"
    );
    assert.equal(updateInput.problem.title, "Type 2 Diabetes Mellitus");
    // Exactly one step: a single tool-calls finish after both calls.
    const finishes = chunks.filter((chunk) => chunk.type === "finish");
    assert.equal(finishes.length, 1);
  });

  test("step 3: encounter result yields closing text", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      KICKOFF,
      toolResult("abc", "getMedicalProblems", {
        sourceToolCallId: "abc",
        results: [],
      }),
      toolResult("def", "createEncounter", {
        sourceToolCallId: "def",
        results: { eid: 901 },
      }),
    ]);
    assert.equal(toolCallOf(chunks), undefined);
    const text = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join("");
    assert.match(text, /Charted the encounter/);
  });

  test("kickoff does not fall through to the patient-search scenario", () => {
    const chunks = chunksForPrompt([SYSTEM, KICKOFF]);
    assert.notEqual(toolCallOf(chunks)?.toolName, "searchPatients");
  });
});
