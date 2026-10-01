import assert from "node:assert/strict";
import test from "node:test";

process.env.GEMINI_API_KEY ??= "gemini-test-key";

let getPlannerAssistantAnswer: typeof import("./gemini").getPlannerAssistantAnswer;
test.before(async () => {
  ({ getPlannerAssistantAnswer } = await import("./gemini"));
});

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("falls back to Flash-Lite when the primary model is in high demand", async () => {
  const requestedModels: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedModels.push(url);
    if (url.includes("gemini-3.8-flash")) {
      return Response.json({ error: { message: "Model is experiencing high demand." } }, { status: 503 });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: "Start with the overdue task." }] } }] });
  };

  const answer = await getPlannerAssistantAnswer("suggest", undefined, []);

  assert.equal(answer, "Start with the overdue task.");
  assert.equal(requestedModels.length, 2);
  assert.match(requestedModels[0], /gemini-3\.8-flash:generateContent$/);
  assert.match(requestedModels[1], /gemini-2\.5-flash-lite:generateContent$/);
});

test("does not retry with a fallback when Gemini rejects the API key", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json({ error: { message: "API key not valid." } }, { status: 403 });
  };

  await assert.rejects(
    getPlannerAssistantAnswer("ask", "How many tasks?", []),
    /Gemini rejected the API key/,
  );
  assert.equal(requestCount, 1);
});

test("reports temporary high demand when all models are unavailable", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json({ error: { message: "Currently experiencing high demand." } }, { status: 503 });
  };

  await assert.rejects(
    getPlannerAssistantAnswer("suggest", undefined, []),
    /All Gemini models are temporarily experiencing high demand/,
  );
  assert.equal(requestCount, 2);
});
