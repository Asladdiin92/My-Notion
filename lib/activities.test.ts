import assert from "node:assert/strict";
import test from "node:test";
import { validateActivityInput } from "./activities";

const validInput = {
  type: "task_created",
  source: "dashboard",
  title: "Created a planner task",
  entityType: "task",
  entityId: "task-123",
  metadata: { priority: "high", category: "study" },
};

test("validates activity enums and builds ownership/timestamps from server arguments", () => {
  const timestamp = new Date("2026-10-05T00:00:00.000Z");
  const activity = validateActivityInput("clerk-user-123", validInput, timestamp);

  assert.equal(activity.userId, "clerk-user-123");
  assert.equal(activity.type, "task_created");
  assert.equal(activity.source, "dashboard");
  assert.equal(activity.title, "Created a planner task");
  assert.equal(activity.occurredAt.toISOString(), timestamp.toISOString());
  assert.equal(activity.createdAt.toISOString(), timestamp.toISOString());
  assert.equal(activity.updatedAt.toISOString(), timestamp.toISOString());
});

test("rejects missing or unstable authenticated user IDs", () => {
  assert.throws(() => validateActivityInput("", validInput), /stable authenticated user ID/);
  assert.throws(() => validateActivityInput(" user ", validInput), /stable authenticated user ID/);
  assert.throws(() => validateActivityInput("u".repeat(257), validInput), /stable authenticated user ID/);
});

test("rejects frontend-supplied user ownership and unsupported activity values", () => {
  assert.throws(
    () => validateActivityInput("trusted-server-user", { ...validInput, userId: "attacker-user" }),
    /user ownership is server-controlled/,
  );
  assert.throws(() => validateActivityInput("trusted-server-user", { ...validInput, type: "unknown" }), /supported activity type/);
  assert.throws(() => validateActivityInput("trusted-server-user", { ...validInput, source: "frontend" }), /supported activity source/);
});

test("rejects sensitive metadata keys and values", () => {
  assert.throws(
    () => validateActivityInput("trusted-server-user", { ...validInput, metadata: { apiKey: "do-not-store" } }),
    /sensitive fields/,
  );
  assert.throws(
    () => validateActivityInput("trusted-server-user", { ...validInput, metadata: { detail: "person@example.com" } }),
    /sensitive values/,
  );
  assert.throws(
    () => validateActivityInput("trusted-server-user", { ...validInput, metadata: { authorization: "Bearer abcdefghijklmnop" } }),
    /sensitive fields/,
  );
});

test("limits metadata size, nesting, and non-JSON values", () => {
  assert.throws(
    () => validateActivityInput("trusted-server-user", { ...validInput, metadata: { values: Array(5).fill("x".repeat(900)) } }),
    /4 KB or smaller/,
  );
  assert.throws(
    () => validateActivityInput("trusted-server-user", { ...validInput, metadata: { one: { two: { three: { four: { five: { six: true } } } } } } }),
    /nested too deeply/,
  );
  assert.throws(
    () => validateActivityInput("trusted-server-user", { ...validInput, metadata: { missing: undefined } }),
    /only JSON values/,
  );
});

test("requires a title and applies bounded optional text fields", () => {
  assert.throws(() => validateActivityInput("trusted-server-user", { ...validInput, title: " " }), /Activity title/);
  assert.throws(() => validateActivityInput("trusted-server-user", { ...validInput, entityId: "x".repeat(201) }), /entityId/);
});
