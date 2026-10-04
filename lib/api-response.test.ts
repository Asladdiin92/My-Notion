import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorMessage, readApiResponse } from "./api-response";

test("reads JSON API responses", async () => {
  const response = Response.json({ ok: true, count: 3 });
  assert.deepEqual(await readApiResponse(response), { ok: true, count: 3 });
});

test("turns HTML error pages into an actionable message", async () => {
  const response = new Response("<html>Not found</html>", {
    status: 404,
    headers: { "Content-Type": "text/html" },
  });
  await assert.rejects(readApiResponse(response), /unexpected response \(HTTP 404\)/);
});

test("reports malformed JSON without leaking the response body", async () => {
  const response = new Response("private provider details", {
    headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(readApiResponse(response), /invalid response \(HTTP 200\)/);
});

test("maps connectivity and timeout failures to retry guidance", () => {
  assert.match(apiErrorMessage(new TypeError("Failed to fetch"), "fallback"), /Check your connection and try again/);
  assert.match(apiErrorMessage(Object.assign(new Error("timeout"), { name: "TimeoutError" }), "fallback"), /request timed out/i);
  assert.equal(apiErrorMessage(null, "fallback"), "fallback");
});
