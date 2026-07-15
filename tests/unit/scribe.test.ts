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

describe("buildScribeKickoffMessage", () => {
  test("includes header with patient identifiers, appointment, and transcript", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromAppointment(APPOINTMENT),
      transcript: "BP 132 over 84.",
    });
    assert.ok(
      message.startsWith(
        `${SCRIBE_SESSION_HEADER} Eleanor Vance (uuid: ${PATIENT.uuid}, pid: 1).`
      )
    );
    assert.match(message, /Appointment: Hypertension Check on 2026-07-14/);
    assert.ok(message.includes(SCRIBE_TRANSCRIPT_MARKER));
    assert.ok(message.endsWith("BP 132 over 84."));
  });

  test("omits the appointment line for a patient-only selection", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "Transcript body.",
    });
    assert.doesNotMatch(message, /Appointment:/);
    assert.ok(message.includes(SCRIBE_TRANSCRIPT_MARKER));
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

  test("step 2: problems result emits createEncounter with vitals and SOAP note", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      KICKOFF,
      toolResult("abc", "getMedicalProblems", {
        sourceToolCallId: "abc",
        results: [],
      }),
    ]);
    const call = toolCallOf(chunks);
    assert.equal(call?.toolName, "createEncounter");
    assert.ok(call?.input.includes('"vitals"'));
    assert.ok(call?.input.includes('"soapNote"'));
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
