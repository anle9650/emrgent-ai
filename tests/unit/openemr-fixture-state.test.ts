import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  resolveOpenEmrFixture,
  withFixtureState,
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

// Each stateful test runs inside withFixtureState, so overlay writes stay
// private to the test — the isolation the eval runner relies on per row.
describe("stateful fixture overlay (OPENEMR_FIXTURES=true)", () => {
  test("created encounters show up in the encounter list", () => {
    enableOverlay();
    withFixtureState(() => {
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
    disableOverlay();
  });

  test("soap_note and vital attachments are readable after POST", () => {
    enableOverlay();
    withFixtureState(() => {
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
      assert.equal(
        soapNotes[0].assessment,
        "Osteoarthritis of the right knee."
      );

      const vitals = resolveOpenEmrFixture(`${base}/vital`) as {
        bps: string | null;
        pulse: string | null;
      }[];
      assert.equal(vitals.length, 1);
      assert.equal(vitals[0].bps, "130");
      assert.equal(vitals[0].pulse, null);
    });
    disableOverlay();
  });

  test("interleaved withFixtureState scopes are isolated", () => {
    enableOverlay();
    const baseline = withFixtureState(() => listEncounters().length);

    // Interleave writes across two live scopes; neither sees the other's.
    withFixtureState(() => {
      createEncounter("Scope A visit");
      withFixtureState(() => {
        createEncounter("Scope B visit");
        const inner = listEncounters();
        assert.equal(inner.length, baseline + 1);
        assert.equal(inner.at(-1)?.reason, "Scope B visit");
      });
      const outer = listEncounters();
      assert.equal(outer.length, baseline + 1);
      assert.equal(outer.at(-1)?.reason, "Scope A visit");
    });

    // A fresh scope starts pristine again.
    withFixtureState(() => {
      assert.equal(listEncounters().length, baseline);
    });
    disableOverlay();
  });

  test("scope survives awaits, and parallel async scopes stay isolated", async () => {
    enableOverlay();
    const run = (reason: string, delayMs: number) =>
      withFixtureState(async () => {
        createEncounter(reason);
        // Yield so the two runs interleave across the await boundary.
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const rows = listEncounters();
        return { count: rows.length, last: rows.at(-1)?.reason };
      });

    const baseline = withFixtureState(() => listEncounters().length);
    const [a, b] = await Promise.all([run("Visit A", 20), run("Visit B", 5)]);
    assert.deepEqual(a, { count: baseline + 1, last: "Visit A" });
    assert.deepEqual(b, { count: baseline + 1, last: "Visit B" });
    disableOverlay();
  });

  test("writes outside any scope land in the shared default store", () => {
    enableOverlay();
    const before = listEncounters().length;
    // The Playwright-server path: no withFixtureState context.
    createEncounter("Default-store visit");
    assert.equal(listEncounters().length, before + 1);
    // Scoped readers don't see default-store rows...
    withFixtureState(() => {
      assert.equal(listEncounters().length, before);
    });
    // ...and the default store still holds the row afterwards.
    assert.equal(listEncounters().at(-1)?.reason, "Default-store visit");
    disableOverlay();
  });

  test("unparsable bodies fall back to empty fields, not a crash", () => {
    enableOverlay();
    withFixtureState(() => {
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
    disableOverlay();
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
