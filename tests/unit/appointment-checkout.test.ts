import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  resolveOpenEmrFixture,
  withFixtureState,
} from "@/lib/openemr/fixtures";
import type { Appointment } from "@/lib/openemr/types";

// The appointment "check out" flow is delete-original + recreate-with-status,
// with a live getOne read gating idempotency. checkOutAppointment itself calls
// openemrFetch (server-only, not importable under the tsx unit runner — the
// scribe evals cover that layer), so these tests drive the fixture overlay
// directly, exercising every primitive the helper composes: getOne, the DELETE
// tombstone, and the status-honoring recreate.

const CHECKED_OUT = ">";
// A base-roster appointment (not in the overlay) — proves the tombstone hides
// base rows too, which is the whole point for the demo's roomed patients.
const BASE_EID = "300";
const BASE_PID = "1";

const enableOverlay = () => {
  process.env.OPENEMR_FIXTURES = "true";
};
const disableOverlay = () => {
  delete process.env.OPENEMR_FIXTURES;
};

beforeEach(enableOverlay);
afterEach(disableOverlay);

const practiceCalendar = () =>
  resolveOpenEmrFixture("/api/appointment") as Appointment[];

const patientCalendar = (pid: string) =>
  resolveOpenEmrFixture(`/api/patient/${pid}/appointment`) as Appointment[];

const getOne = (eid: string) =>
  resolveOpenEmrFixture(`/api/appointment/${eid}`) as Appointment[];

const deleteAppointment = (pid: string, eid: string) =>
  resolveOpenEmrFixture(
    `/api/patient/${pid}/appointment/${eid}`,
    undefined,
    "DELETE"
  );

// The POST fixture reads the body as the raw JSON string openemrFetch passes;
// the resolver takes it as the 4th arg, so call it that way.
const bookRecreate = (pid: string, status: string) =>
  resolveOpenEmrFixture(
    `/api/patient/${pid}/appointment`,
    undefined,
    "POST",
    JSON.stringify({
      pc_catid: "5",
      pc_title: "Follow-up",
      pc_duration: "1800",
      pc_apptstatus: status,
      pc_eventDate: "2026-07-23",
      pc_startTime: "09:00",
    })
  ) as { id: number };

describe("appointment checkout — fixture overlay behavior", () => {
  test("getOne returns the appointment as a single-element array", () => {
    withFixtureState(() => {
      const rows = getOne(BASE_EID);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].pc_eid, BASE_EID);
    });
  });

  test("DELETE tombstones a base-roster appointment across every read", () => {
    withFixtureState(() => {
      assert.ok(practiceCalendar().some((a) => a.pc_eid === BASE_EID));

      deleteAppointment(BASE_PID, BASE_EID);

      assert.ok(!practiceCalendar().some((a) => a.pc_eid === BASE_EID));
      assert.ok(!patientCalendar(BASE_PID).some((a) => a.pc_eid === BASE_EID));
      // getOne now empty — this is exactly what makes the helper's idempotency
      // guard treat a repeat call as "already checked out".
      assert.equal(getOne(BASE_EID).length, 0);
    });
  });

  test("recreate with '>' status persists on the calendar", () => {
    withFixtureState(() => {
      const { id } = bookRecreate(BASE_PID, CHECKED_OUT);
      const created = practiceCalendar().find((a) => a.pc_eid === String(id));
      assert.ok(created);
      assert.equal(created?.pc_apptstatus, CHECKED_OUT);
    });
  });

  test("full sequence (recreate '>' then delete original) leaves one checked-out row", () => {
    withFixtureState(() => {
      // Mirror checkOutAppointment: recreate first, then delete the original.
      bookRecreate(BASE_PID, CHECKED_OUT);
      deleteAppointment(BASE_PID, BASE_EID);

      const patientRows = patientCalendar(BASE_PID);
      assert.ok(!patientRows.some((a) => a.pc_eid === BASE_EID));
      const checkedOut = patientRows.filter(
        (a) => a.pc_apptstatus === CHECKED_OUT
      );
      assert.equal(checkedOut.length, 1);
    });
  });

  test("scopes are isolated — a delete doesn't leak to the next scope", () => {
    withFixtureState(() => {
      deleteAppointment(BASE_PID, BASE_EID);
      assert.equal(getOne(BASE_EID).length, 0);
    });
    // Fresh scope: the base roster is pristine again.
    withFixtureState(() => {
      assert.equal(getOne(BASE_EID).length, 1);
    });
  });
});
