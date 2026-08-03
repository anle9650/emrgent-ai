import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { selectionFromAppointment } from "@/lib/ai/scribe";
import {
  type DetectedEncounter,
  groupByPatient,
  matchScribePatient,
  SCRIBE_SEGMENT_JOIN,
  sliceTranscript,
  wordCount,
} from "@/lib/ai/scribe-split";
import type { Appointment } from "@/lib/openemr/types";

// Three back-to-back visits, each comfortably over the 25-word segment floor,
// as one recording the clinician forgot to stop.
const VISIT_A =
  "Good morning Eleanor, come on in and have a seat. How have things been since we started the lisinopril back in the spring? Any dizziness, any swelling in the ankles? Good. Your pressure today reads one thirty-two over eighty, which is right where we want it. Let's recheck the A1c in three months.";
const VISIT_B =
  "Thanks for waiting, Marcus. How is the knee since the injection we did last month? Still catching when you go down stairs? Let me have a look at it. There is a little effusion there but the ligaments feel stable to me. I want you back in physical therapy twice a week.";
const VISIT_C =
  "Hello Sofia, nice to see you again. Your mother mentioned the cough has been keeping you up at night. Is it worse in the mornings or the evenings? Let me listen to your chest and take a quick look at your throat before we talk about the inhaler.";

const TWO = `${VISIT_A} ${VISIT_B}`;
const THREE = `${VISIT_A} ${VISIT_B} ${VISIT_C}`;

function detected(
  ...anchors: { startsWith: string; patientName?: string }[]
): DetectedEncounter[] {
  return anchors.map((anchor, index) => ({
    startsWith: anchor.startsWith,
    patientName: anchor.patientName ?? "",
    chiefComplaint: `complaint ${index}`,
  }));
}

const ANCHOR_A = "Good morning Eleanor, come on in and have a seat.";
const ANCHOR_B = "Thanks for waiting, Marcus. How is the knee since the";
const ANCHOR_C = "Hello Sofia, nice to see you again. Your mother mentioned";

describe("sliceTranscript", () => {
  test("verbatim anchors split into ordered segments", () => {
    const result = sliceTranscript(
      TWO,
      detected(
        { startsWith: ANCHOR_A, patientName: "Eleanor Vance" },
        { startsWith: ANCHOR_B, patientName: "Marcus Webb" }
      )
    );

    assert.equal(result.length, 2);
    assert.equal(result[0].text, VISIT_A);
    assert.equal(result[1].text, VISIT_B);
    assert.equal(result[0].patientName, "Eleanor Vance");
    assert.equal(result[1].patientName, "Marcus Webb");
  });

  test("segments rejoin to the input — no clinical text is lost or invented", () => {
    const result = sliceTranscript(
      TWO,
      detected({ startsWith: ANCHOR_A }, { startsWith: ANCHOR_B })
    );

    assert.equal(result.map((encounter) => encounter.text).join(" "), TWO);
    for (const encounter of result) {
      assert.ok(
        TWO.includes(encounter.text),
        "every segment must be a verbatim slice of the input"
      );
    }
  });

  test("anchor differing in casing, punctuation and whitespace still matches", () => {
    const result = sliceTranscript(
      TWO,
      detected(
        { startsWith: ANCHOR_A },
        { startsWith: "thanks   for waiting marcus how is the knee since the" }
      )
    );

    assert.equal(result.length, 2);
    assert.equal(result[1].text, VISIT_B);
  });

  test("long anchor whose tail is wrong falls back to a shorter word prefix", () => {
    const result = sliceTranscript(
      TWO,
      detected(
        { startsWith: ANCHOR_A },
        {
          // First seven words are right; the rest is transcription drift.
          startsWith:
            "Thanks for waiting, Marcus. How is your knee doing after that cortisone shot we talked about",
        }
      )
    );

    assert.equal(result.length, 2);
    assert.equal(result[1].text, VISIT_B);
  });

  test("encounters[0]'s anchor is ignored — the first segment always starts at index 0", () => {
    const result = sliceTranscript(
      TWO,
      detected(
        { startsWith: "some text that appears nowhere in this recording" },
        { startsWith: ANCHOR_B }
      )
    );

    assert.equal(result.length, 2);
    assert.equal(result[0].text, VISIT_A);
  });

  test("an unfindable anchor is dropped, collapsing to a single encounter", () => {
    const result = sliceTranscript(
      TWO,
      detected(
        { startsWith: ANCHOR_A, patientName: "Eleanor Vance" },
        { startsWith: "and then the patient left in a hot air balloon" }
      )
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].text, TWO);
    assert.equal(result[0].patientName, "Eleanor Vance");
  });

  test("anchors given out of order stay in transcript order", () => {
    const result = sliceTranscript(
      TWO,
      detected(
        { startsWith: ANCHOR_A, patientName: "Eleanor Vance" },
        // Points backwards, before boundary 0's start.
        { startsWith: "Good morning Eleanor", patientName: "Marcus Webb" }
      )
    );

    // The backwards anchor can't produce a boundary after the previous one,
    // so it's dropped rather than reordering the segments.
    assert.equal(result.length, 1);
    assert.equal(result[0].text, TWO);
  });

  test("a boundary carving out a sub-floor segment is dropped", () => {
    // The second anchor lands near the very end, leaving a final segment far
    // shorter than a visit.
    const result = sliceTranscript(
      TWO,
      detected({ startsWith: ANCHOR_A }, { startsWith: "twice a week" })
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].text, TWO);
  });

  test("three encounters slice into three ordered segments", () => {
    const result = sliceTranscript(
      THREE,
      detected(
        { startsWith: ANCHOR_A, patientName: "Eleanor Vance" },
        { startsWith: ANCHOR_B, patientName: "Marcus Webb" },
        { startsWith: ANCHOR_C, patientName: "Sofia Reyes" }
      )
    );

    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((encounter) => encounter.text),
      [VISIT_A, VISIT_B, VISIT_C]
    );
    assert.equal(result.map((encounter) => encounter.text).join(" "), THREE);
  });

  test("an unfindable middle anchor merges into the PRECEDING segment", () => {
    const result = sliceTranscript(
      THREE,
      detected(
        { startsWith: ANCHOR_A, patientName: "Eleanor Vance" },
        {
          startsWith: "no such line was ever spoken here",
          patientName: "Marcus Webb",
        },
        { startsWith: ANCHOR_C, patientName: "Sofia Reyes" }
      )
    );

    assert.equal(result.length, 2);
    // Marcus's visit joins Eleanor's segment. That's the safe direction: it
    // stays with the patient already under review rather than being filed
    // under Sofia, the next patient.
    assert.equal(result[0].text, `${VISIT_A} ${VISIT_B}`);
    assert.equal(result[0].patientName, "Eleanor Vance");
    assert.equal(result[1].text, VISIT_C);
    assert.equal(result[1].patientName, "Sofia Reyes");
  });

  test("fewer than two detected encounters passes through untouched", () => {
    assert.deepEqual(
      sliceTranscript(
        TWO,
        detected({ startsWith: ANCHOR_A, patientName: "Eleanor Vance" })
      ),
      [
        {
          text: TWO,
          patientName: "Eleanor Vance",
          chiefComplaint: "complaint 0",
        },
      ]
    );
    assert.deepEqual(sliceTranscript(TWO, []), [
      { text: TWO, patientName: null, chiefComplaint: "" },
    ]);
  });

  test("an empty transcript never splits", () => {
    const result = sliceTranscript(
      "   ",
      detected({ startsWith: ANCHOR_A }, { startsWith: ANCHOR_B })
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "");
  });

  test("an empty patientName becomes null rather than an empty string", () => {
    const result = sliceTranscript(
      TWO,
      detected({ startsWith: ANCHOR_A }, { startsWith: ANCHOR_B })
    );
    assert.equal(result[0].patientName, null);
    assert.equal(result[1].patientName, null);
  });
});

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    pc_eid: "1",
    pc_uuid: "appt-uuid",
    fname: "Marcus",
    lname: "Webb",
    DOB: "1974-03-02",
    pid: "12",
    puuid: "9f1c0a6e-0000-4000-8000-000000000012",
    pce_aid_uuid: "prov-uuid",
    pce_aid_fname: "Alice",
    pce_aid_lname: "Nguyen",
    pce_aid_npi: null,
    pc_apptstatus: "<",
    pc_eventDate: "2026-08-02",
    pc_startTime: "10:15:00",
    pc_endTime: "10:30:00",
    pc_time: "2026-08-02 09:00:00",
    pc_title: "Knee Pain Follow-up",
    facility_name: "Main Clinic",
    ...overrides,
  };
}

const MARCUS = appointment({});
const ELEANOR = appointment({
  pc_eid: "2",
  fname: "Eleanor",
  lname: "Vance",
  pid: "7",
  puuid: "9f1c0a6e-0000-4000-8000-000000000007",
  pc_title: "Annual Physical",
});

describe("matchScribePatient", () => {
  test("full name resolves, carrying the appointment ref", () => {
    const match = matchScribePatient("Marcus Webb", [MARCUS, ELEANOR], []);
    assert.equal(match?.patient.pid, 12);
    assert.equal(match?.patient.name, "Marcus Webb");
    // The eid is what lets the ViewChartCard's Check Out action work for the
    // second session too.
    assert.equal(match?.appointment?.pc_eid, "1");
  });

  test("first name alone resolves", () => {
    assert.equal(
      matchScribePatient("Marcus", [MARCUS, ELEANOR], [])?.patient.pid,
      12
    );
  });

  test("last name alone resolves", () => {
    assert.equal(
      matchScribePatient("Webb", [MARCUS, ELEANOR], [])?.patient.pid,
      12
    );
  });

  test("casing and punctuation are ignored", () => {
    assert.equal(
      matchScribePatient("marcus webb.", [MARCUS, ELEANOR], [])?.patient.pid,
      12
    );
  });

  test("two candidates scoring equally -> null, never a guess", () => {
    const otherMarcus = appointment({
      pc_eid: "3",
      lname: "Delgado",
      pid: "21",
      puuid: "9f1c0a6e-0000-4000-8000-000000000021",
    });
    assert.equal(matchScribePatient("Marcus", [MARCUS, otherMarcus], []), null);
  });

  test("an excluded pid is skipped, so two segments can't share a chart", () => {
    assert.equal(
      matchScribePatient("Marcus Webb", [MARCUS, ELEANOR], [12]),
      null
    );
  });

  test("excluding one of two same-first-name candidates disambiguates the other", () => {
    const otherMarcus = appointment({
      pc_eid: "3",
      lname: "Delgado",
      pid: "21",
      puuid: "9f1c0a6e-0000-4000-8000-000000000021",
    });
    assert.equal(
      matchScribePatient("Marcus", [MARCUS, otherMarcus], [12])?.patient.pid,
      21
    );
  });

  test("no hint, empty hint, or no match -> null", () => {
    assert.equal(matchScribePatient(null, [MARCUS], []), null);
    assert.equal(matchScribePatient("", [MARCUS], []), null);
    assert.equal(matchScribePatient("   ", [MARCUS], []), null);
    assert.equal(
      matchScribePatient("Priya Raman", [MARCUS, ELEANOR], []),
      null
    );
  });

  test("an empty calendar -> null", () => {
    assert.equal(matchScribePatient("Marcus Webb", [], []), null);
  });
});

describe("groupByPatient", () => {
  const marcus = selectionFromAppointment(MARCUS);
  const eleanor = selectionFromAppointment(ELEANOR);

  test("distinct patients pass through untouched, in order", () => {
    const units = groupByPatient([
      { selection: eleanor, text: VISIT_A },
      { selection: marcus, text: VISIT_B },
    ]);
    assert.equal(units.length, 2);
    assert.equal(units[0].selection.patient.pid, 7);
    assert.equal(units[0].transcript, VISIT_A);
    assert.equal(units[1].selection.patient.pid, 12);
    assert.equal(units[1].transcript, VISIT_B);
  });

  test("adjacent segments on one patient join in transcript order", () => {
    const units = groupByPatient([
      { selection: eleanor, text: VISIT_A },
      { selection: eleanor, text: VISIT_C },
    ]);
    assert.equal(units.length, 1);
    assert.equal(
      units[0].transcript,
      `${VISIT_A}${SCRIBE_SEGMENT_JOIN}${VISIT_C}`
    );
  });

  // The safety case: the patient stepped back in after someone else's visit.
  // Joining across the gap must carry none of the intervening patient's speech.
  test("non-adjacent segments join without the patient in between", () => {
    const units = groupByPatient([
      { selection: eleanor, text: VISIT_A },
      { selection: marcus, text: VISIT_B },
      { selection: eleanor, text: VISIT_C },
    ]);
    assert.equal(units.length, 2);
    assert.equal(units[0].selection.patient.pid, 7);
    assert.equal(
      units[0].transcript,
      `${VISIT_A}${SCRIBE_SEGMENT_JOIN}${VISIT_C}`
    );
    assert.ok(!units[0].transcript.includes("Marcus"));
    assert.equal(units[1].transcript, VISIT_B);
  });

  // Group order follows first appearance, so whichever patient owns segment 0
  // stays at index 0 — that's the unit sendSessions puts in the foreground.
  test("first appearance fixes group order, not the merge", () => {
    const units = groupByPatient([
      { selection: marcus, text: VISIT_B },
      { selection: eleanor, text: VISIT_A },
      { selection: marcus, text: VISIT_C },
    ]);
    assert.deepEqual(
      units.map((unit) => unit.selection.patient.pid),
      [12, 7]
    );
  });

  test("no assignments -> no sessions", () => {
    assert.deepEqual(groupByPatient([]), []);
  });
});

describe("wordCount", () => {
  test("counts words, ignoring surrounding and repeated whitespace", () => {
    assert.equal(wordCount("  one   two\nthree "), 3);
    assert.equal(wordCount(""), 0);
    assert.equal(wordCount("   "), 0);
  });
});
