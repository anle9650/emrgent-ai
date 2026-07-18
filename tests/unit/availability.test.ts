import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAppointmentCandidates } from "@/lib/openemr/availability";
import type { Appointment } from "@/lib/openemr/types";

// A fixed Monday–Friday week, so weekday logic is deterministic.
const MONDAY = "2026-07-20";
const TUESDAY = "2026-07-21";
const SATURDAY = "2026-07-25";
const SUNDAY = "2026-07-26";

function booking(overrides: Partial<Appointment>): Appointment {
  return {
    pc_eid: "1",
    pc_uuid: "u",
    fname: "Eleanor",
    lname: "Vance",
    DOB: "1948-03-12",
    pid: "1",
    puuid: "p",
    pce_aid_uuid: "a",
    pce_aid_fname: "Susan",
    pce_aid_lname: "Reyes",
    pce_aid_npi: null,
    pc_apptstatus: "-",
    pc_eventDate: MONDAY,
    pc_startTime: "09:00:00",
    pc_endTime: "09:30:00",
    pc_time: "",
    pc_title: "Office Visit",
    facility_name: "Harbor Family Practice",
    ...overrides,
  };
}

const startTimesOn = (
  candidates: ReturnType<typeof buildAppointmentCandidates>,
  date: string
) =>
  candidates
    .filter((candidate) => candidate.pc_eventDate === date)
    .map((candidate) => candidate.pc_startTime);

describe("buildAppointmentCandidates", () => {
  test("fills the window on a 15-minute grid when nothing is booked", () => {
    const candidates = buildAppointmentCandidates({
      booked: [],
      duration: 900,
      startDate: MONDAY,
      endDate: MONDAY,
    });
    // 09:00 through 16:45 inclusive = 32 quarter-hours.
    assert.equal(candidates.length, 32);
    assert.equal(candidates[0].pc_startTime, "09:00");
    assert.equal(candidates.at(-1)?.pc_startTime, "16:45");
    assert.deepEqual(
      { ...candidates[0] },
      {
        pc_catid: "5",
        pc_title: "Office Visit",
        pc_duration: "900",
        pc_apptstatus: "-",
        pc_eventDate: MONDAY,
        pc_startTime: "09:00",
      }
    );
  });

  test("excludes slots overlapping a booked appointment", () => {
    const candidates = buildAppointmentCandidates({
      booked: [booking({ pc_startTime: "09:00:00", pc_duration: "1800" })],
      duration: 900,
      startDate: MONDAY,
      endDate: MONDAY,
    });
    const times = startTimesOn(candidates, MONDAY);
    assert.equal(times.includes("09:00"), false);
    assert.equal(times.includes("09:15"), false);
    assert.equal(times.includes("09:30"), true);
  });

  test("a longer appointment must clear the booking entirely", () => {
    const candidates = buildAppointmentCandidates({
      booked: [booking({ pc_startTime: "10:00:00", pc_duration: "900" })],
      duration: 3600,
      startDate: MONDAY,
      endDate: MONDAY,
    });
    const times = startTimesOn(candidates, MONDAY);
    // Any hour-long slot starting 09:15–10:00 would run into the 10:00 visit.
    assert.equal(times.includes("09:00"), true);
    assert.equal(times.includes("09:15"), false);
    assert.equal(times.includes("10:00"), false);
    assert.equal(times.includes("10:15"), true);
  });

  test("falls back to pc_endTime when pc_duration is missing", () => {
    const candidates = buildAppointmentCandidates({
      booked: [
        booking({
          pc_startTime: "09:00:00",
          pc_endTime: "10:00:00",
          pc_duration: undefined,
        }),
      ],
      duration: 900,
      startDate: MONDAY,
      endDate: MONDAY,
    });
    const times = startTimesOn(candidates, MONDAY);
    assert.equal(times.includes("09:45"), false);
    assert.equal(times.includes("10:00"), true);
  });

  test("a slot must finish by the end of the window", () => {
    const candidates = buildAppointmentCandidates({
      booked: [],
      duration: 1800,
      startDate: MONDAY,
      endDate: MONDAY,
      startTime: "09:00",
      endTime: "10:00",
    });
    assert.deepEqual(startTimesOn(candidates, MONDAY), [
      "09:00",
      "09:15",
      "09:30",
    ]);
  });

  test("skips weekends and spans the date range", () => {
    const candidates = buildAppointmentCandidates({
      booked: [],
      duration: 900,
      startDate: SATURDAY,
      endDate: SUNDAY,
    });
    assert.deepEqual(candidates, []);

    const week = buildAppointmentCandidates({
      booked: [],
      duration: 900,
      startDate: MONDAY,
      endDate: TUESDAY,
    });
    assert.deepEqual(
      [...new Set(week.map((candidate) => candidate.pc_eventDate))],
      [MONDAY, TUESDAY]
    );
  });

  test("bookings on other days don't block a slot", () => {
    const candidates = buildAppointmentCandidates({
      booked: [booking({ pc_eventDate: TUESDAY, pc_startTime: "09:00:00" })],
      duration: 900,
      startDate: MONDAY,
      endDate: MONDAY,
    });
    assert.equal(startTimesOn(candidates, MONDAY).includes("09:00"), true);
  });

  test("a custom title lands on every candidate; the category does not move", () => {
    const candidates = buildAppointmentCandidates({
      booked: [],
      duration: 900,
      startDate: MONDAY,
      endDate: MONDAY,
      title: "A1c recheck",
    });
    assert.equal(candidates[0].pc_title, "A1c recheck");
    assert.equal(candidates[0].pc_catid, "5");
    assert.ok(
      candidates.every((candidate) => candidate.pc_title === "A1c recheck")
    );
  });

  test("caps the returned list", () => {
    const candidates = buildAppointmentCandidates({
      booked: [],
      duration: 900,
      startDate: MONDAY,
      endDate: TUESDAY,
      limit: 5,
    });
    assert.equal(candidates.length, 5);
  });

  test("returns nothing for a degenerate window", () => {
    assert.deepEqual(
      buildAppointmentCandidates({
        booked: [],
        duration: 900,
        startDate: MONDAY,
        endDate: MONDAY,
        startTime: "17:00",
        endTime: "09:00",
      }),
      []
    );
  });
});
