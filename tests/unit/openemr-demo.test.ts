import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { demoDataset, demoTranscriptByUuid } from "@/lib/openemr/demo-data";
import { resolveDemoFixture } from "@/lib/openemr/fixtures";

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
  test("today has a full schedule with at least half in exam room", () => {
    const appts = resolveDemoFixture(
      "user-schedule",
      "/api/appointment"
    ) as Appt[];
    const todays = appts.filter((a) => a.pc_eventDate === today());
    assert.ok(todays.length >= 8, `expected a full day, got ${todays.length}`);

    const roomed = todays.filter((a) => a.pc_apptstatus === "<");
    assert.ok(
      roomed.length >= Math.ceil(todays.length / 2),
      `expected >= half roomed, got ${roomed.length}/${todays.length}`
    );
  });
});

describe("demo instance — consistent, stateful reads", () => {
  test("patient search filters the roster by name", () => {
    const eleanor = resolveDemoFixture("user-search", "/api/patient", {
      fname: "Eleanor",
    }) as Envelope<{ fname: string }[]>;
    assert.equal(eleanor.data.length, 1);
    assert.equal(eleanor.data[0].fname, "Eleanor");

    const all = resolveDemoFixture("user-search", "/api/patient") as Envelope<
      unknown[]
    >;
    assert.ok(all.data.length >= 8);
  });

  test("a booked appointment reads back on the practice-wide calendar", () => {
    const userId = "user-booking";
    const start = "12:15"; // an open slot not on the seeded grid
    const before = resolveDemoFixture(userId, "/api/appointment") as Appt[];

    const created = bookAppointment(userId, 3, start) as { id: number };
    assert.equal(typeof created.id, "number");

    const after = resolveDemoFixture(userId, "/api/appointment") as Appt[];
    assert.equal(after.length, before.length + 1);
    assert.ok(
      after.some(
        (a) => a.pc_eventDate === today() && a.pc_startTime.startsWith(start)
      ),
      "booked appointment should read back"
    );

    // ...and on the patient's own calendar.
    const mine = resolveDemoFixture(
      userId,
      "/api/patient/3/appointment"
    ) as Appt[];
    assert.ok(mine.some((a) => a.pc_startTime.startsWith(start)));
  });

  test("created problem and update patch both read back", () => {
    const userId = "user-chart";
    const patientUuid = "22222222-2222-4222-8222-222222222222"; // Marcus

    const created = resolveDemoFixture(
      userId,
      `/api/patient/${patientUuid}/medical_problem`,
      undefined,
      "POST",
      JSON.stringify({
        title: "Seasonal allergic rhinitis",
        begdate: today(),
        diagnosis: "ICD10:J30.2",
      })
    ) as Envelope<{ uuid: string }>;
    const newUuid = created.data.uuid;
    assert.equal(typeof newUuid, "string");

    const readProblems = () =>
      (
        resolveDemoFixture(
          userId,
          `/api/patient/${patientUuid}/medical_problem`
        ) as Envelope<{ uuid: string; title: string; enddate: string | null }[]>
      ).data;

    const row = readProblems().find((p) => p.uuid === newUuid);
    assert.ok(row, "created problem should appear in the problem list");
    assert.equal(row?.title, "Seasonal allergic rhinitis");

    // Resolve it (updateMedicalProblem sends only the changed field).
    resolveDemoFixture(
      userId,
      `/api/patient/${patientUuid}/medical_problem/${newUuid}`,
      undefined,
      "PUT",
      JSON.stringify({ enddate: today() })
    );

    const patched = readProblems().find((p) => p.uuid === newUuid);
    assert.equal(patched?.enddate, today(), "update patch should read back");
  });

  test("state is isolated between users", () => {
    bookAppointment("user-a", 1, "12:45");

    const userB = resolveDemoFixture(
      "user-b",
      "/api/patient/1/appointment"
    ) as Appt[];
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
