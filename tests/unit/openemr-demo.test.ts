import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { demoDataset, demoTranscriptByUuid } from "@/lib/openemr/demo-data";
import { resolveDemoFixture } from "@/lib/openemr/fixtures";
import {
  computeLocalDate,
  runWithViewerTimeZone,
} from "@/lib/openemr/viewer-time";

// The demo instance serves a per-user, stateful mock OpenEMR to sessions with
// no OpenEMR token (see lib/openemr/api.ts). These tests drive the resolver
// directly, the way api.ts's demo branch does.

type Envelope<T> = { data: T };
type Appt = {
  pid: string;
  pc_eventDate: string;
  pc_apptstatus: string;
  pc_startTime: string;
};

const today = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const bookAppointment = (userId: string, pid: number, startTime: string) =>
  resolveDemoFixture(
    userId,
    `/api/patient/${pid}/appointment`,
    undefined,
    "POST",
    JSON.stringify({
      pc_eventDate: today(),
      pc_startTime: startTime,
      pc_duration: "1800",
      pc_title: "Follow-up",
    })
  );

describe("demo instance — always-on daily schedule", () => {
  test("today has a full schedule with at least half in exam room", async () => {
    const appts = (await resolveDemoFixture(
      "user-schedule",
      "/api/appointment"
    )) as Appt[];
    const todays = appts.filter((a) => a.pc_eventDate === today());
    assert.ok(todays.length >= 8, `expected a full day, got ${todays.length}`);

    const roomed = todays.filter((a) => a.pc_apptstatus === "<");
    assert.ok(
      roomed.length >= Math.ceil(todays.length / 2),
      `expected >= half roomed, got ${roomed.length}/${todays.length}`
    );
  });

  test("schedule is stamped in the viewer's timezone, not the server's", async () => {
    // Kiritimati (UTC+14) is a day ahead of UTC for part of every day, so a
    // UTC-stamped schedule would land on the wrong calendar day for that viewer.
    const tz = "Pacific/Kiritimati";
    const viewerToday = computeLocalDate(tz);

    const appts = (await runWithViewerTimeZone(tz, () =>
      resolveDemoFixture("user-tz", "/api/appointment")
    )) as Appt[];

    assert.ok(
      appts.some((a) => a.pc_eventDate === viewerToday),
      `expected appointments on the viewer's ${viewerToday}, got ${[
        ...new Set(appts.map((a) => a.pc_eventDate)),
      ].join(", ")}`
    );
  });
});

describe("demo instance — consistent, stateful reads", () => {
  test("patient search filters the roster by name", async () => {
    const eleanor = (await resolveDemoFixture("user-search", "/api/patient", {
      fname: "Eleanor",
    })) as Envelope<{ fname: string }[]>;
    assert.equal(eleanor.data.length, 1);
    assert.equal(eleanor.data[0].fname, "Eleanor");

    const all = (await resolveDemoFixture(
      "user-search",
      "/api/patient"
    )) as Envelope<unknown[]>;
    assert.ok(all.data.length >= 8);
  });

  test("a booked appointment reads back on the practice-wide calendar", async () => {
    const userId = "user-booking";
    const start = "12:15"; // an open slot not on the seeded grid
    const before = (await resolveDemoFixture(
      userId,
      "/api/appointment"
    )) as Appt[];

    const created = (await bookAppointment(userId, 3, start)) as { id: number };
    assert.equal(typeof created.id, "number");

    const after = (await resolveDemoFixture(
      userId,
      "/api/appointment"
    )) as Appt[];
    assert.equal(after.length, before.length + 1);
    assert.ok(
      after.some(
        (a) => a.pc_eventDate === today() && a.pc_startTime.startsWith(start)
      ),
      "booked appointment should read back"
    );

    // ...and on the patient's own calendar.
    const mine = (await resolveDemoFixture(
      userId,
      "/api/patient/3/appointment"
    )) as Appt[];
    assert.ok(mine.some((a) => a.pc_startTime.startsWith(start)));
  });

  test("created problem and update patch both read back", async () => {
    const userId = "user-chart";
    const patientUuid = "22222222-2222-4222-8222-222222222222"; // Marcus

    const created = (await resolveDemoFixture(
      userId,
      `/api/patient/${patientUuid}/medical_problem`,
      undefined,
      "POST",
      JSON.stringify({
        title: "Seasonal allergic rhinitis",
        begdate: today(),
        diagnosis: "ICD10:J30.2",
      })
    )) as Envelope<{ uuid: string }>;
    const newUuid = created.data.uuid;
    assert.equal(typeof newUuid, "string");

    const readProblems = async () =>
      (
        (await resolveDemoFixture(
          userId,
          `/api/patient/${patientUuid}/medical_problem`
        )) as Envelope<
          { uuid: string; title: string; enddate: string | null }[]
        >
      ).data;

    const row = (await readProblems()).find((p) => p.uuid === newUuid);
    assert.ok(row, "created problem should appear in the problem list");
    assert.equal(row?.title, "Seasonal allergic rhinitis");

    // Resolve it (updateMedicalProblem sends only the changed field).
    await resolveDemoFixture(
      userId,
      `/api/patient/${patientUuid}/medical_problem/${newUuid}`,
      undefined,
      "PUT",
      JSON.stringify({ enddate: today() })
    );

    const patched = (await readProblems()).find((p) => p.uuid === newUuid);
    assert.equal(patched?.enddate, today(), "update patch should read back");
  });

  test("state is isolated between users", async () => {
    await bookAppointment("user-a", 1, "12:45");

    const userB = (await resolveDemoFixture(
      "user-b",
      "/api/patient/1/appointment"
    )) as Appt[];
    assert.ok(
      !userB.some((a) => a.pc_startTime.startsWith("12:45")),
      "user B must not see user A's booking"
    );
  });

  test("every demo patient has a canned encounter transcript", () => {
    // The "Use demo recording" shortcut serves demoTranscriptByUuid keyed on
    // patient uuid — every roster patient must have a non-empty transcript.
    for (const patient of demoDataset.patients) {
      const transcript = demoTranscriptByUuid[patient.uuid];
      assert.ok(
        typeof transcript === "string" && transcript.trim().length > 0,
        `missing demo transcript for ${patient.uuid}`
      );
    }
  });
});
