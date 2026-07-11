import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  filterUpcomingAppointments,
  pickLatestVitals,
  toMedicalIssueSummary,
} from "@/lib/openemr/summaries";
import type { Appointment, MedicalIssue, Vital } from "@/lib/openemr/types";

function makeVital(overrides: Partial<Vital>): Vital {
  return {
    id: 1,
    form_id: 1,
    date: "2026-01-01 09:00:00",
    bps: null,
    bpd: null,
    weight: null,
    height: null,
    temperature: null,
    pulse: null,
    respiration: null,
    oxygen_saturation: null,
    ...overrides,
  };
}

function makeAppointment(overrides: Partial<Appointment>): Appointment {
  return {
    pc_eid: "1",
    pc_uuid: "uuid-1",
    fname: "Jane",
    lname: "Doe",
    DOB: "1980-01-01",
    pid: "1",
    puuid: "puuid-1",
    pce_aid_uuid: "provider-1",
    pce_aid_fname: "Sam",
    pce_aid_lname: "Smith",
    pce_aid_npi: null,
    pc_apptstatus: "-",
    pc_eventDate: "2026-07-11",
    pc_startTime: "09:00:00",
    pc_endTime: "09:30:00",
    pc_time: "2026-07-01 12:00:00",
    pc_title: "Office Visit",
    facility_name: "Main Clinic",
    ...overrides,
  };
}

function makeIssue(overrides: Partial<MedicalIssue>): MedicalIssue {
  return {
    id: 1,
    uuid: "issue-1",
    title: "Essential hypertension",
    begdate: "2020-05-01",
    enddate: null,
    diagnosis: null,
    comments: "",
    outcome: 0,
    occurrence: 0,
    referredby: "",
    ...overrides,
  };
}

describe("pickLatestVitals", () => {
  test("returns null when there are no readings", () => {
    assert.equal(pickLatestVitals([]), null);
    assert.equal(pickLatestVitals([[], []]), null);
  });

  test("skips readings whose measurements are all null", () => {
    const empty = makeVital({ date: "2026-03-01 10:00:00" });
    const recorded = makeVital({
      date: "2026-01-15 10:00:00",
      pulse: "72.000000",
    });
    const latest = pickLatestVitals([[empty], [recorded]]);
    assert.equal(latest?.date, "2026-01-15 10:00:00");
    assert.equal(latest?.vitals.pulse, 72);
  });

  test("picks the most recent reading across lists", () => {
    const older = makeVital({ date: "2026-01-01 09:00:00", weight: "180" });
    const newer = makeVital({
      date: "2026-06-01 09:00:00",
      bps: "120.000000",
      bpd: "80.000000",
    });
    const latest = pickLatestVitals([[older], [newer]]);
    assert.equal(latest?.date, "2026-06-01 09:00:00");
    assert.equal(latest?.vitals.bps, 120);
    assert.equal(latest?.vitals.bpd, 80);
  });
});

describe("filterUpcomingAppointments", () => {
  test("keeps today's appointments (inclusive boundary)", () => {
    const today = makeAppointment({ pc_eventDate: "2026-07-11" });
    const past = makeAppointment({ pc_eid: "2", pc_eventDate: "2026-07-10" });
    const upcoming = filterUpcomingAppointments([past, today], "2026-07-11");
    assert.deepEqual(
      upcoming.map((appointment) => appointment.pc_eid),
      ["1"]
    );
  });

  test("sorts soonest first by date then start time", () => {
    const laterDay = makeAppointment({
      pc_eid: "1",
      pc_eventDate: "2026-08-01",
      pc_startTime: "08:00:00",
    });
    const sameDayLater = makeAppointment({
      pc_eid: "2",
      pc_eventDate: "2026-07-20",
      pc_startTime: "14:00:00",
    });
    const sameDayEarlier = makeAppointment({
      pc_eid: "3",
      pc_eventDate: "2026-07-20",
      pc_startTime: "09:00:00",
    });
    const upcoming = filterUpcomingAppointments(
      [laterDay, sameDayLater, sameDayEarlier],
      "2026-07-11"
    );
    assert.deepEqual(
      upcoming.map((appointment) => appointment.pc_eid),
      ["3", "2", "1"]
    );
  });
});

describe("toMedicalIssueSummary", () => {
  test("derives active from a missing end date", () => {
    assert.equal(toMedicalIssueSummary(makeIssue({})).active, true);
    assert.equal(
      toMedicalIssueSummary(makeIssue({ enddate: "2025-01-01" })).active,
      false
    );
  });

  test("splits legacy semicolon-separated diagnosis strings", () => {
    const summary = toMedicalIssueSummary(
      makeIssue({ diagnosis: "ICD10:E11.9;ICD10:I10" })
    );
    assert.deepEqual(summary.diagnosis, [
      { code: "ICD10:E11.9", description: null },
      { code: "ICD10:I10", description: null },
    ]);
  });

  test("flattens code-keyed coding objects", () => {
    const summary = toMedicalIssueSummary(
      makeIssue({
        diagnosis: {
          "E11.9": {
            code: "E11.9",
            description: "Type 2 diabetes mellitus",
            code_type: "ICD10",
            system: "http://hl7.org/fhir/sid/icd-10-cm",
          },
        },
      })
    );
    assert.deepEqual(summary.diagnosis, [
      { code: "ICD10:E11.9", description: "Type 2 diabetes mellitus" },
    ]);
  });

  test("returns no codes for an empty diagnosis", () => {
    assert.deepEqual(toMedicalIssueSummary(makeIssue({})).diagnosis, []);
    assert.deepEqual(
      toMedicalIssueSummary(makeIssue({ diagnosis: "" })).diagnosis,
      []
    );
  });
});
