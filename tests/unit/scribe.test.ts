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
  buildScribePriorChart,
  parseScribeKickoff,
  readScribeChartState,
  SCRIBE_PRIOR_CHART_MARKER,
  SCRIBE_SESSION_HEADER,
  SCRIBE_TRANSCRIPT_MARKER,
  type ScribePriorChartSections,
  scribeChatTitle,
  scribePriorChartBlockOf,
  selectionFromAppointment,
  selectionFromPatient,
  summarizeScribeChartWrites,
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
const VISIT_TIME = "14:05";

describe("buildScribeKickoffMessage", () => {
  test("includes header with patient identifiers, visit date, appointment, and transcript", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromAppointment(APPOINTMENT),
      transcript: "BP 132 over 84.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
    });
    assert.ok(
      message.startsWith(
        `${SCRIBE_SESSION_HEADER} Eleanor Vance (uuid: ${PATIENT.uuid}, pid: 1).`
      )
    );
    assert.match(message, /Visit date: 2026-07-15\./);
    assert.match(message, /Visit time: 14:05\./);
    // The appointment join supplies DOB but not sex.
    assert.match(message, /DOB: 1948-03-12\./);
    assert.doesNotMatch(message, /Sex:/);
    assert.match(message, /Appointment: Hypertension Check on 2026-07-14/);
    assert.ok(message.includes(SCRIBE_TRANSCRIPT_MARKER));
    assert.ok(message.endsWith("BP 132 over 84."));
  });

  test("omits the appointment line for a patient-only selection", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "Transcript body.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
    });
    assert.doesNotMatch(message, /Appointment:/);
    assert.match(message, /DOB: 1948-03-12\./);
    assert.match(message, /Sex: Female\./);
    assert.ok(message.includes(SCRIBE_TRANSCRIPT_MARKER));
  });
});

// A minimal prefetched chart in the patient-overview section shapes; the
// diabetes problem mirrors the fixture chart (uuid/id fields kept — the
// reconciliation writes copy them verbatim).
const DIABETES = {
  uuid: "66666666-6666-4666-8666-666666666601",
  title: "Type 2 Diabetes Mellitus",
  begdate: "2015-06-01",
  enddate: null,
  active: true,
  diagnosis: [{ code: "ICD10:E11.9", description: null }],
  comments: "Managed with metformin.",
};

const priorChartWith = (
  problems: (typeof DIABETES)[]
): ScribePriorChartSections => ({
  problems: { data: problems },
  medications: {
    data: [
      {
        id: 4,
        title: "Metformin 500mg",
        begdate: "2015-06-01",
        enddate: null,
        active: true,
        diagnosis: [],
        comments: "",
      },
    ],
  },
  surgeries: { data: [] },
  allergies: { data: [] },
  encounters: { data: { items: [], total: 3 } },
});

describe("buildScribePriorChart", () => {
  test("renders every section under its header as single-line JSON", () => {
    const block = buildScribePriorChart(priorChartWith([DIABETES]));
    const lines = block.split("\n");
    assert.equal(lines[0], SCRIBE_PRIOR_CHART_MARKER);
    const headerIndexes = [
      "#### Medical problems",
      "#### Medications",
      "#### Surgeries",
      "#### Allergies",
      "#### Recent encounters (showing 0 of 3, newest first)",
    ].map((header) => lines.indexOf(header));
    // Present, in order, each followed by exactly one value line.
    assert.ok(headerIndexes.every((index) => index > 0));
    assert.deepEqual(
      headerIndexes,
      [...headerIndexes].sort((a, b) => a - b)
    );
    assert.equal(
      lines[headerIndexes[0] + 1],
      JSON.stringify([DIABETES]),
      "problems serialize on the single line after their header"
    );
    assert.equal(lines[headerIndexes[2] + 1], "[]");
  });

  test("errored sections point at their read tool; allergies have none", () => {
    const block = buildScribePriorChart({
      problems: { error: true },
      medications: { error: true },
      surgeries: { error: true },
      allergies: { error: true },
      encounters: { error: true },
    });
    assert.ok(
      block.includes("Unavailable — call getMedicalProblems to fetch.")
    );
    assert.ok(block.includes("Unavailable — call getMedications to fetch."));
    assert.ok(block.includes("Unavailable — call getSurgeries to fetch."));
    assert.ok(block.includes("Unavailable — call getEncounters to fetch."));
    assert.match(block, /#### Allergies\nUnavailable\.\n/);
  });

  test("scrubs marker strings out of serialized chart values", () => {
    const block = buildScribePriorChart(
      priorChartWith([
        {
          ...DIABETES,
          comments: `quoting a kickoff: ${SCRIBE_TRANSCRIPT_MARKER} and ${SCRIBE_PRIOR_CHART_MARKER}`,
        },
      ])
    );
    assert.ok(!block.includes(SCRIBE_TRANSCRIPT_MARKER));
    // The block's own leading marker is the only occurrence left.
    assert.equal(
      block.indexOf(
        SCRIBE_PRIOR_CHART_MARKER,
        SCRIBE_PRIOR_CHART_MARKER.length
      ),
      -1
    );
    // The scrubbed text survives, minus its marker prefix.
    assert.ok(block.includes("quoting a kickoff: Encounter transcript"));
  });
});

describe("kickoff with a prior chart", () => {
  const message = () =>
    buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "BP 132 over 84.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
      priorChart: priorChartWith([DIABETES]),
    });

  test("splices the block between the instruction and the transcript marker", () => {
    const text = message();
    const blockIndex = text.indexOf(SCRIBE_PRIOR_CHART_MARKER);
    const markerIndex = text.indexOf(SCRIBE_TRANSCRIPT_MARKER);
    assert.ok(blockIndex > 0);
    assert.ok(blockIndex < markerIndex);
    assert.ok(text.endsWith("BP 132 over 84."));
  });

  test("parseScribeKickoff never scans the block for header fields", () => {
    const spoofed = buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "Body.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
      priorChart: priorChartWith([
        // Chart content shaped like header lines must not leak into fields.
        { ...DIABETES, comments: "Sex: Male. Visit date: 1999-01-01." },
      ]),
    });
    const parsed = parseScribeKickoff(spoofed);
    assert.equal(parsed.sex, "Female");
    assert.equal(parsed.visitDate, VISIT_DATE);
    assert.equal(parsed.transcript, "Body.");
    assert.equal(scribeChatTitle(spoofed), "Eleanor Vance · Jul 15, 2026");
  });

  test("scribePriorChartBlockOf extracts the block; null when absent", () => {
    const block = scribePriorChartBlockOf(message());
    assert.ok(block?.startsWith(SCRIBE_PRIOR_CHART_MARKER));
    assert.ok(block?.includes("#### Medications"));
    assert.ok(!block?.includes(SCRIBE_TRANSCRIPT_MARKER));
    assert.ok(!block?.includes("BP 132 over 84."));
    const bare = buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "Body.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
    });
    assert.equal(scribePriorChartBlockOf(bare), null);
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
      visitTime: VISIT_TIME,
    });
    const parsed = parseScribeKickoff(message);
    assert.equal(parsed.patientName, "Eleanor Vance");
    assert.equal(parsed.uuid, PATIENT.uuid);
    assert.equal(parsed.pid, 1);
    assert.equal(parsed.DOB, "1948-03-12");
    assert.equal(parsed.sex, null);
    assert.equal(parsed.visitDate, VISIT_DATE);
    assert.equal(parsed.visitTime, VISIT_TIME);
    assert.equal(parsed.appointmentTitle, "Hypertension Check");
    assert.equal(parsed.transcript, "BP 132 over 84.\n\nContinue lisinopril.");
  });

  test("recovers name, visit date, and transcript, with null appointment, for a patient-only kickoff", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "Transcript body.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
    });
    const parsed = parseScribeKickoff(message);
    assert.equal(parsed.patientName, "Eleanor Vance");
    assert.equal(parsed.DOB, "1948-03-12");
    assert.equal(parsed.sex, "Female");
    assert.equal(parsed.visitDate, VISIT_DATE);
    assert.equal(parsed.appointmentTitle, null);
    assert.equal(parsed.transcript, "Transcript body.");
  });

  test("returns null visit date and demographics for a message saved before they were baked in", () => {
    const legacy = `${SCRIBE_SESSION_HEADER} Eleanor Vance (uuid: ${PATIENT.uuid}, pid: 1).\n\n${SCRIBE_TRANSCRIPT_MARKER}\n\nBody.`;
    const parsed = parseScribeKickoff(legacy);
    assert.equal(parsed.visitDate, null);
    assert.equal(parsed.visitTime, null);
    assert.equal(parsed.DOB, null);
    assert.equal(parsed.sex, null);
  });

  test("ignores DOB/sex-shaped lines inside the transcript", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromAppointment(APPOINTMENT),
      transcript: "Chart notes read aloud:\nSex: Male.\nDOB: 1990-01-01.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
    });
    const parsed = parseScribeKickoff(message);
    assert.equal(parsed.DOB, "1948-03-12");
    assert.equal(parsed.sex, null);
  });
});

describe("scribeChatTitle", () => {
  test("titles a kickoff with the patient name and visit date, no time", () => {
    const message = buildScribeKickoffMessage({
      ...selectionFromAppointment(APPOINTMENT),
      transcript: "BP 132 over 84.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
    });
    assert.equal(scribeChatTitle(message), "Eleanor Vance · Jul 15, 2026");
  });

  test("falls back to the name alone when the visit date is missing", () => {
    const legacy = `${SCRIBE_SESSION_HEADER} Eleanor Vance (uuid: ${PATIENT.uuid}, pid: 1).\n\n${SCRIBE_TRANSCRIPT_MARKER}\n\nBody.`;
    assert.equal(scribeChatTitle(legacy), "Eleanor Vance");
  });

  test("returns null for a message that is not a parseable kickoff", () => {
    assert.equal(scribeChatTitle("Tell me about hypertension."), null);
  });
});

describe("readScribeChartState", () => {
  const kickoff = () =>
    buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "Body.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
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
    assert.equal(state?.patient.DOB, "1948-03-12");
    assert.equal(state?.patient.sex, "Female");
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

describe("summarizeScribeChartWrites", () => {
  const write = (type: string, overrides: Record<string, unknown> = {}) => ({
    type,
    state: "output-available",
    toolCallId: `${type}-${Math.random()}`,
    output: { results: { ok: true } },
    ...overrides,
  });

  test("aggregates create and update calls per section", () => {
    const writes = summarizeScribeChartWrites([
      write("tool-createMedicalProblem"),
      write("tool-updateMedicalProblem"),
      write("tool-createMedication"),
      write("tool-createSurgery"),
      write("tool-createEncounter"),
    ]);
    assert.deepEqual(writes, {
      problems: 2,
      medications: 1,
      surgeries: 1,
      encounterFiled: true,
    });
  });

  test("skips pending, denied, and errored calls, and ignores read tools", () => {
    const writes = summarizeScribeChartWrites([
      write("tool-createMedicalProblem", { state: "approval-requested" }),
      write("tool-createMedication", { state: "output-denied" }),
      write("tool-updateMedication", { output: { error: "API error" } }),
      write("tool-getMedications"),
      write("tool-createEncounter"),
    ]);
    assert.deepEqual(writes, {
      problems: 0,
      medications: 0,
      surgeries: 0,
      encounterFiled: true,
    });
  });

  test("reports nothing charted for an empty part set", () => {
    assert.deepEqual(summarizeScribeChartWrites([]), {
      problems: 0,
      medications: 0,
      surgeries: 0,
      encounterFiled: false,
    });
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

// Built with the REAL serializer: these tests are the lock on the format
// coupling between buildScribePriorChart and the mock's line-based parse
// (firstProblemFromPriorChart in lib/ai/models.mock.ts) — a serializer
// change that breaks the mock fails here, not silently in e2e.
const scribeKickoff = (priorChart?: ScribePriorChartSections) =>
  user(
    buildScribeKickoffMessage({
      ...selectionFromPatient(PATIENT),
      transcript: "BP 132 over 84. Continue lisinopril.",
      visitDate: VISIT_DATE,
      visitTime: VISIT_TIME,
      priorChart,
    })
  );

// A slot the (client-resolved) selectAppointmentSlot call hands back — the
// same shape appointmentCandidateSchema serves and createAppointment books.
const CHOSEN_SLOT = {
  pc_catid: "5",
  pc_title: "Blood pressure recheck",
  pc_duration: "900",
  pc_apptstatus: "-",
  pc_eventDate: "2026-01-19",
  pc_startTime: "09:00",
};

// Prompt prefixes replaying the script up to a given step — scheduling
// happens FIRST (the patient is still in the room; the chart writes stall
// behind approvals), so the slot selection and booking precede the writes.
// selectAppointmentSlot's result is the raw union ({chosenSlot}|{skipped}),
// not the {sourceToolCallId, results} envelope the server tools use.
const afterSelect = (
  priorChart?: ScribePriorChartSections,
  selection: unknown = { chosenSlot: CHOSEN_SLOT }
) => [
  SYSTEM,
  scribeKickoff(priorChart),
  toolResult("jkl", "selectAppointmentSlot", selection),
];

const afterBooking = (priorChart?: ScribePriorChartSections) => [
  ...afterSelect(priorChart),
  toolResult("book", "createAppointment", {
    sourceToolCallId: "book",
    results: { booked: CHOSEN_SLOT, created: {} },
  }),
];

const afterUpdate = (priorChart?: ScribePriorChartSections) => [
  ...afterBooking(priorChart),
  toolResult("abc", "updateMedicalProblem", {
    sourceToolCallId: "abc",
    results: { message: "updated" },
  }),
];

const afterCreate = (priorChart?: ScribePriorChartSections) => [
  ...afterUpdate(priorChart),
  toolResult("med", "createMedication", {
    sourceToolCallId: "med",
    results: { id: 12, title: "Loratadine 10mg" },
  }),
];

const afterWrites = (priorChart?: ScribePriorChartSections) => [
  ...afterCreate(priorChart),
  toolResult("def", "createEncounter", {
    sourceToolCallId: "def",
    results: { eid: 901 },
  }),
];

// The dermatology referral discussed in the visit is filed after the encounter
// and before the patient message (scribePrompt step 7). Its result is the
// {sourceToolCallId, results} envelope the server tools use.
const afterReferral = (priorChart?: ScribePriorChartSections) => [
  ...afterWrites(priorChart),
  toolResult("ref", "sendReferral", {
    sourceToolCallId: "ref",
    results: { transaction: 555 },
  }),
];

const afterMessage = (priorChart?: ScribePriorChartSections) => [
  ...afterReferral(priorChart),
  toolResult("msg", "sendMessage", {
    sourceToolCallId: "msg",
    results: {
      to: "Eleanor",
      from: "Dr. Reyes",
      title: "Your Hypertension Visit Summary",
      body: "Summary body.",
    },
  }),
];

const afterViewChart = (priorChart?: ScribePriorChartSections) => [
  ...afterMessage(priorChart),
  toolResult("mno", "generateUI", { ok: true }),
];

// getNextAppointment's result is the {sourceToolCallId, results} envelope the
// server tools use; `results` is the next roomed appointment (or null).
const afterNext = (priorChart?: ScribePriorChartSections) => [
  ...afterViewChart(priorChart),
  toolResult("nxt", "getNextAppointment", {
    sourceToolCallId: "nxt",
    results: { ...APPOINTMENT, pid: "2", fname: "Marcus", lname: "Webb" },
  }),
];

describe("mock scribe script", () => {
  test("step 1: kickoff yields the follow-up slot selection before any write", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      scribeKickoff(priorChartWith([DIABETES])),
    ]);
    const call = toolCallOf(chunks);
    // A no-execute client tool: this call pauses the run until the picker
    // resolves it.
    assert.equal(call?.toolName, "selectAppointmentSlot");
    // The patient ref comes from the kickoff header, as a real model would.
    assert.equal(JSON.parse(call?.input ?? "{}").patient.pid, 1);
  });

  test("step 2: a chosen slot yields createAppointment booking it verbatim", () => {
    const chunks = chunksForPrompt(afterSelect(priorChartWith([DIABETES])));
    const call = toolCallOf(chunks);
    assert.equal(call?.toolName, "createAppointment");
    const input = JSON.parse(call?.input ?? "{}");
    assert.equal(input.patient.pid, 1);
    // The slot is copied verbatim from the picker's result.
    assert.deepEqual(input.slot, CHOSEN_SLOT);
  });

  test("step 2 (skipped): no booking — proceeds straight to the update wave", () => {
    const chunks = chunksForPrompt(
      afterSelect(priorChartWith([DIABETES]), { skipped: true })
    );
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.ok(!calls.some((call) => call.toolName === "createAppointment"));
    assert.deepEqual(
      calls.map((call) => call.toolName),
      ["updateMedicalProblem"]
    );
  });

  test("step 3a (prior chart with a problem): the update wave emits updateMedicalProblem ALONE", () => {
    const chunks = chunksForPrompt(afterBooking(priorChartWith([DIABETES])));
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.deepEqual(
      calls.map((call) => call.toolName),
      ["updateMedicalProblem"]
    );
    // The problem ref is copied verbatim from the prior-chart block.
    const updateInput = JSON.parse(calls[0]?.input ?? "{}");
    assert.equal(updateInput.problem.uuid, DIABETES.uuid);
    assert.equal(updateInput.problem.title, DIABETES.title);
    // The wave is its own step — one tool-calls finish, no other write.
    const finishes = chunks.filter((chunk) => chunk.type === "finish");
    assert.equal(finishes.length, 1);
  });

  test("step 3b: after the update resolves, the create wave emits createMedication ALONE", () => {
    const chunks = chunksForPrompt(afterUpdate(priorChartWith([DIABETES])));
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.deepEqual(
      calls.map((call) => call.toolName),
      ["createMedication"]
    );
    assert.match(JSON.parse(calls[0]?.input ?? "{}").title, /loratadine/i);
  });

  test("step 3c: after the create resolves, createEncounter runs ALONE", () => {
    const chunks = chunksForPrompt(afterCreate(priorChartWith([DIABETES])));
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "createEncounter");
    assert.ok(calls[0]?.input.includes('"vitals"'));
    assert.ok(calls[0]?.input.includes('"soapNote"'));
  });

  test("step 3 (empty problem list): skips the update wave, starts at createMedication", () => {
    const chunks = chunksForPrompt(afterBooking(priorChartWith([])));
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "createMedication");
  });

  test("step 3 (no prior-chart block): skips the update wave, starts at createMedication", () => {
    const chunks = chunksForPrompt(afterBooking());
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "createMedication");
  });

  test("step 4: encounter result yields the dermatology referral sendReferral ALONE", () => {
    const chunks = chunksForPrompt(afterWrites(priorChartWith([DIABETES])));
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "sendReferral");
    const input = JSON.parse(calls[0]?.input ?? "{}");
    // Addressed to the visit's patient, with a referred-to provider and reason.
    assert.equal(input.patient.pid, 1);
    assert.ok("referToProvider" in input);
    assert.ok(typeof input.reason === "string" && input.reason.length > 0);
  });

  test("step 5: the filed referral yields the visit-summary sendMessage ALONE", () => {
    const chunks = chunksForPrompt(afterReferral(priorChartWith([DIABETES])));
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "sendMessage");
    const input = JSON.parse(calls[0]?.input ?? "{}");
    // Addressed to the visit's patient, with a plain-language title and body.
    assert.equal(input.patient.pid, 1);
    assert.ok(typeof input.title === "string" && input.title.length > 0);
    assert.ok(typeof input.body === "string" && input.body.length > 0);
  });

  test("step 6: the sent message yields the closing generateUI(ViewChartCard + ReferralCard)", () => {
    const chunks = chunksForPrompt(afterMessage(priorChartWith([DIABETES])));
    const call = toolCallOf(chunks);
    assert.equal(call?.toolName, "generateUI");
    const spec = JSON.parse(call?.input ?? "{}");
    // A Column holds both cards, since a surface has a single root component.
    assert.deepEqual(
      spec.components.map(
        (component: { component: string }) => component.component
      ),
      ["Column", "ViewChartCard", "ReferralCard"]
    );
    const bySource = (name: string) =>
      spec.components.find(
        (component: { component: string; sourceToolCallId?: string }) =>
          component.component === name
      )?.sourceToolCallId;
    // ViewChartCard binds to createEncounter, ReferralCard to sendReferral.
    assert.equal(bySource("ViewChartCard"), "def");
    assert.equal(bySource("ReferralCard"), "ref");
  });

  test("step 7: the ViewChartCard result yields getNextAppointment ALONE", () => {
    const chunks = chunksForPrompt(afterViewChart(priorChartWith([DIABETES])));
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "getNextAppointment");
    // The visit's patient is passed so the tool excludes them from the search.
    assert.equal(JSON.parse(calls[0]?.input ?? "{}").patient.pid, 1);
  });

  test("step 8: the next-appointment result yields closing text", () => {
    const chunks = chunksForPrompt(afterNext(priorChartWith([DIABETES])));
    assert.equal(toolCallOf(chunks), undefined);
    const text = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join("");
    assert.match(text, /charted the encounter/i);
  });

  test("kickoff does not fall through to the patient-search scenario", () => {
    const chunks = chunksForPrompt([SYSTEM, scribeKickoff()]);
    assert.notEqual(toolCallOf(chunks)?.toolName, "searchPatients");
  });
});
