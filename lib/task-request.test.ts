import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskInput } from "./task-request";

test("accepts the full set of optional planner metadata", async () => {
  const parsed = await parseTaskInput(new Request("https://example.com/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Network Design Lab",
      courseCode: "ITeC4111",
      estimatedHours: 3,
      actualHours: 1.5,
      assessment: "Lab",
      creditHours: 3,
      instructor: "Mr. Dessalew G.",
      marksGrade: "Pending",
      nextReviewDate: "2026-10-12T06:00:00.000Z",
      notes: "Capture evidence",
      recurrence: "Weekly",
      resourceLink: "https://example.com/lab",
      semester: "First Semester",
      timeBlock: "Monday morning",
      venueLink: "Room 4",
      dueDate: "2026-10-05T17:00:00.000Z",
      dateEnd: "2026-10-05T18:00:00.000Z",
      deliverable: true,
    }),
  }));

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.input.deliverable, true);
    assert.equal(parsed.input.actualHours, 1.5);
    assert.equal(parsed.input.dateEnd, "2026-10-05T18:00:00.000Z");
    assert.equal(parsed.input.venueLink, "Room 4");
  }
});

test("rejects invalid numeric hours and unsupported metadata", async () => {
  const invalidHours = await parseTaskInput(new Request("https://example.com/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Lab", actualHours: -1 }),
  }));
  assert.deepEqual(invalidHours, { ok: false, error: "actualHours must be a number between 0 and 10,000." });

  const unsupported = await parseTaskInput(new Request("https://example.com/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Lab", peopleInstructorIds: ["notion-id"] }),
  }));
  assert.deepEqual(unsupported, { ok: false, error: "The request contains an unsupported field." });
});
