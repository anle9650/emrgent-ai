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

// Prompt prefixes replaying the script up to a given step — scheduling
// happens FIRST (the patient is still in the room; the chart writes stall
// behind approvals), so slots and the picker surface precede the writes.
const afterSlots = (priorChart?: ScribePriorChartSections) => [
  SYSTEM,
  scribeKickoff(priorChart),
  toolResult("jkl", "getAvailableAppointments", {
    sourceToolCallId: "jkl",
    results: [],
  }),
];

const afterPicker = (priorChart?: ScribePriorChartSections) => [
  ...afterSlots(priorChart),
  toolResult("ghi", "generateUI", { ok: true }),
];

const afterWrites = (priorChart?: ScribePriorChartSections) => [
  ...afterPicker(priorChart),
  toolResult("abc", "updateMedicalProblem", {
    sourceToolCallId: "abc",
    results: { message: "updated" },
  }),
  toolResult("def", "createEncounter", {
    sourceToolCallId: "def",
    results: { eid: 901 },
  }),
];

describe("mock scribe script", () => {
  test("step 1: kickoff yields the follow-up slot search before any write", () => {
    const chunks = chunksForPrompt([
      SYSTEM,
      scribeKickoff(priorChartWith([DIABETES])),
    ]);
    const call = toolCallOf(chunks);
    assert.equal(call?.toolName, "getAvailableAppointments");
    // The pid comes from the kickoff header, as a real model would copy it.
    assert.equal(JSON.parse(call?.input ?? "{}").pid, 1);
  });

  test("step 2: slots yield generateUI with the heading, description, and picker", () => {
    const chunks = chunksForPrompt(afterSlots(priorChartWith([DIABETES])));
    const call = toolCallOf(chunks);
    assert.equal(call?.toolName, "generateUI");
    const spec = JSON.parse(call?.input ?? "{}");
    assert.deepEqual(
      spec.components.map(
        (component: { component: string }) => component.component
      ),
      ["Column", "Text", "Text", "AppointmentPickerCard"]
    );
    const byId = new Map(
      spec.components.map((component: { id: string }) => [
        component.id,
        component,
      ])
    );
    assert.equal(byId.get("picker").sourceToolCallId, "jkl");
    assert.deepEqual(byId.get("col").children, [
      "heading",
      "description",
      "picker",
    ]);
    // The description names the recheck and the patient by first name.
    assert.equal(byId.get("description").variant, "muted");
    assert.match(byId.get("description").text, /recheck for Eleanor\./);
  });

  test("step 3 (prior chart with a problem): emits updateMedicalProblem AND createEncounter in one step", () => {
    const chunks = chunksForPrompt(afterPicker(priorChartWith([DIABETES])));
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.deepEqual(
      calls.map((call) => call.toolName),
      ["updateMedicalProblem", "createEncounter"]
    );
    // The problem ref is copied verbatim from the prior-chart block.
    const updateInput = JSON.parse(calls[0]?.input ?? "{}");
    assert.equal(updateInput.problem.uuid, DIABETES.uuid);
    assert.equal(updateInput.problem.title, DIABETES.title);
    assert.ok(calls[1]?.input.includes('"vitals"'));
    assert.ok(calls[1]?.input.includes('"soapNote"'));
    // Exactly one step: a single tool-calls finish after both calls.
    const finishes = chunks.filter((chunk) => chunk.type === "finish");
    assert.equal(finishes.length, 1);
  });

  test("step 3 (empty problem list): emits only createEncounter", () => {
    const chunks = chunksForPrompt(afterPicker(priorChartWith([])));
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "createEncounter");
  });

  test("step 3 (no prior-chart block): degrades to createEncounter only", () => {
    const chunks = chunksForPrompt(afterPicker());
    const calls = chunks.filter((chunk) => chunk.type === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "createEncounter");
  });

  test("step 4: encounter result yields the closing generateUI(ViewChartCard)", () => {
    const chunks = chunksForPrompt(afterWrites(priorChartWith([DIABETES])));
    const call = toolCallOf(chunks);
    assert.equal(call?.toolName, "generateUI");
    const spec = JSON.parse(call?.input ?? "{}");
    assert.deepEqual(
      spec.components.map(
        (component: { component: string }) => component.component
      ),
      ["ViewChartCard"]
    );
    assert.equal(spec.components[0].sourceToolCallId, "def");
  });

  test("step 5: second generateUI result yields closing text", () => {
    const chunks = chunksForPrompt([
      ...afterWrites(priorChartWith([DIABETES])),
      toolResult("mno", "generateUI", { ok: true }),
    ]);
    assert.equal(toolCallOf(chunks), undefined);
    const text = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join("");
    assert.match(text, /Charted the encounter/);
  });

  test("kickoff does not fall through to the patient-search scenario", () => {
    const chunks = chunksForPrompt([SYSTEM, scribeKickoff()]);
    assert.notEqual(toolCallOf(chunks)?.toolName, "searchPatients");
  });
});
