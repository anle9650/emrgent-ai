import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  resetOpenEmrFixtureState,
  resolveOpenEmrFixture,
} from "@/lib/openemr/fixtures";

const ELEANOR_UUID = "11111111-1111-4111-8111-111111111111";

type Envelope<T> = { data: T };

const enableOverlay = () => {
  process.env.OPENEMR_FIXTURES = "true";
};

const disableOverlay = () => {
  delete process.env.OPENEMR_FIXTURES;
};

const createEncounter = (reason: string) =>
  resolveOpenEmrFixture(
    `/api/patient/${ELEANOR_UUID}/encounter`,
    undefined,
    "POST",
    JSON.stringify({ date: "2026-07-16", reason })
  ) as Envelope<{ encounter: number; uuid: string }>;

const listEncounters = () =>
  (
    resolveOpenEmrFixture(`/api/patient/${ELEANOR_UUID}/encounter`) as Envelope<
      { eid: number; reason: string; date: string }[]
    >
  ).data;

describe("stateful fixture overlay (OPENEMR_FIXTURES=true)", () => {
  afterEach(() => {
    resetOpenEmrFixtureState();
    disableOverlay();
  });

  test("created encounters show up in the encounter list", () => {
    enableOverlay();
    const before = listEncounters().length;

    const created = createEncounter("Hypertension follow-up");
    assert.equal(typeof created.data.encounter, "number");

    const after = listEncounters();
    assert.equal(after.length, before + 1);
    const row = after.at(-1);
    assert.equal(row?.eid, created.data.encounter);
    assert.equal(row?.reason, "Hypertension follow-up");
    assert.ok(row?.date.startsWith("2026-07-16"));
  });

  test("soap_note and vital attachments are readable after POST", () => {
    enableOverlay();
    const eid = createEncounter("Knee pain").data.encounter;
    const base = `/api/patient/1/encounter/${eid}`;

    resolveOpenEmrFixture(
      `${base}/soap_note`,
      undefined,
      "POST",
      JSON.stringify({
        subjective: "Knee aches when kneeling.",
        objective: "Crepitus, no effusion.",
        assessment: "Osteoarthritis of the right knee.",
        plan: "Acetaminophen 500mg PRN.",
      })
    );
    resolveOpenEmrFixture(
      `${base}/vital`,
      undefined,
      "POST",
      JSON.stringify({ bps: "130", bpd: "82" })
    );

    const soapNotes = resolveOpenEmrFixture(`${base}/soap_note`) as {
      assessment: string;
    }[];
    assert.equal(soapNotes.length, 1);
    assert.equal(soapNotes[0].assessment, "Osteoarthritis of the right knee.");

    const vitals = resolveOpenEmrFixture(`${base}/vital`) as {
      bps: string | null;
      pulse: string | null;
    }[];
    assert.equal(vitals.length, 1);
    assert.equal(vitals[0].bps, "130");
    assert.equal(vitals[0].pulse, null);
  });

  test("reset clears dynamic rows", () => {
    enableOverlay();
    const before = listEncounters().length;
    createEncounter("To be discarded");
    assert.equal(listEncounters().length, before + 1);

    resetOpenEmrFixtureState();
    assert.equal(listEncounters().length, before);
  });

  test("unparsable bodies fall back to empty fields, not a crash", () => {
    enableOverlay();
    const created = resolveOpenEmrFixture(
      `/api/patient/${ELEANOR_UUID}/encounter`,
      undefined,
      "POST",
      "not json"
    ) as Envelope<{ encounter: number }>;
    assert.equal(typeof created.data.encounter, "number");
    const row = listEncounters().at(-1);
    assert.equal(row?.reason, "");
  });
});

describe("stateless fixtures (Playwright behavior unchanged)", () => {
  test("writes return the canned response and are not recorded", () => {
    delete process.env.OPENEMR_FIXTURES;
    const before = listEncounters().length;

    const created = createEncounter("Should not persist");
    assert.equal(created.data.encounter, 901);
    assert.equal(listEncounters().length, before);
  });
});
