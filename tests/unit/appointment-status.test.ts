import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  countInExamRoom,
  IN_EXAM_ROOM_STATUS,
} from "@/lib/openemr/appointment-status";
import type { Appointment } from "@/lib/openemr/types";

// The sidebar's waiting-room badge counts today's roomed patients. The count
// itself is the only piece worth pinning down — everything around it (the SWR
// key, the scribe-mode gate) is React wiring.

const appointment = (status: string, eid: string): Appointment =>
  ({
    pc_eid: eid,
    pc_apptstatus: status,
    pc_eventDate: "2026-08-01",
    pc_startTime: "09:00:00",
  }) as Appointment;

describe("countInExamRoom", () => {
  test("counts only the in-exam-room status", () => {
    const appointments = [
      appointment(IN_EXAM_ROOM_STATUS, "1"),
      appointment("-", "2"), // Scheduled
      appointment("@", "3"), // Arrived
      appointment(IN_EXAM_ROOM_STATUS, "4"),
      appointment(">", "5"), // Checked out
    ];

    assert.equal(countInExamRoom(appointments), 2);
  });

  test("returns 0 for an empty roster", () => {
    assert.equal(countInExamRoom([]), 0);
  });

  test("returns 0 while the roster is still loading", () => {
    assert.equal(countInExamRoom(undefined), 0);
  });

  test("returns 0 when nobody has been roomed", () => {
    assert.equal(
      countInExamRoom([appointment("-", "1"), appointment("?", "2")]),
      0
    );
  });
});
