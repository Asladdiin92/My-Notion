import assert from "node:assert/strict";
import test from "node:test";

process.env.NOTION_API_KEY ??= "notion-test-token";
process.env.NOTION_DATABASE_ID ??= "notion-test-database";

let notion: typeof import("./notion");
test.before(async () => {
  notion = await import("./notion");
});

const database = {
  properties: {
    Item: { type: "title", title: {} },
    Type: { type: "select", select: { options: [{ name: "Task" }, { name: "Deliverable" }] } },
    Status: { type: "status", status: { options: [{ name: "Planned" }, { name: "In progress" }] } },
    Priority: { type: "select", select: { options: [{ name: "High" }, { name: "Medium" }, { name: "Low" }] } },
    Area: { type: "select", select: { options: [{ name: "University" }] } },
    Course: { type: "select", select: { options: [{ name: "General" }] } },
    Date: { type: "date", date: {} },
    "Next Action": { type: "rich_text", rich_text: {} },
    Completed: { type: "checkbox", checkbox: {} },
  },
};

const originalFetch = globalThis.fetch;

function mockNotion(page: Record<string, unknown>, capture: (url: string, init: RequestInit, body: Record<string, unknown>) => void) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/databases/notion-test-database") && (!init.method || init.method === "GET")) {
      return Response.json(database);
    }
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    capture(url, init, body);
    return Response.json(page);
  };
}

function page(properties: Record<string, unknown>) {
  return {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    url: "https://www.notion.so/test-task",
    created_time: "2026-10-01T00:00:00.000Z",
    properties,
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("creates a task using schema-aware defaults when fields are omitted", async () => {
  let createBody: Record<string, unknown> = {};
  mockNotion(page({
    Item: { type: "title", title: [{ plain_text: "Read chapter" }] },
    Type: { type: "select", select: { name: "Deliverable" } },
    Status: { type: "status", status: { name: "Planned" } },
    Priority: { type: "select", select: { name: "Medium" } },
  }), (_url, init, body) => {
    assert.equal(init.method, "POST");
    createBody = body;
  });

  const task = await notion.createNotionTask({ title: "Read chapter" });
  const properties = createBody.properties as Record<string, Record<string, unknown>>;

  assert.deepEqual(createBody.parent, { database_id: "notion-test-database" });
  assert.deepEqual(properties.Type, { select: { name: "Deliverable" } });
  assert.deepEqual(properties.Status, { status: { name: "Planned" } });
  assert.deepEqual(properties.Priority, { select: { name: "Medium" } });
  assert.equal(task.title, "Read chapter");
});

test("creates a task with a confirmed local date-time due date", async () => {
  let createBody: Record<string, unknown> = {};
  mockNotion(page({
    Item: { type: "title", title: [{ plain_text: "Algorithms homework" }] },
    Type: { type: "select", select: { name: "Task" } },
    Status: { type: "status", status: { name: "Planned" } },
    Date: { type: "date", date: { start: "2026-10-05T14:00:00+03:00" } },
  }), (_url, _init, body) => { createBody = body; });

  const task = await notion.createNotionTask({
    title: "Algorithms homework",
    dueDate: "2026-10-05T14:00:00+03:00",
  });
  const properties = createBody.properties as Record<string, Record<string, unknown>>;

  assert.deepEqual(properties.Date, { date: { start: "2026-10-05T14:00:00+03:00" } });
  assert.equal(task.dueDate, "2026-10-05T14:00:00+03:00");
});

test("updates task properties and clears optional values", async () => {
  let updateBody: Record<string, unknown> = {};
  mockNotion(page({
    Item: { type: "title", title: [{ plain_text: "Updated" }] },
    Type: { type: "select", select: { name: "Task" } },
    Status: { type: "status", status: { name: "In progress" } },
    Priority: { type: "select", select: null },
    Area: { type: "select", select: null },
    Course: { type: "select", select: null },
    Date: { type: "date", date: null },
    "Next Action": { type: "rich_text", rich_text: [] },
  }), (url, init, body) => {
    assert.ok(url.endsWith("/pages/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"));
    assert.equal(init.method, "PATCH");
    updateBody = body;
  });

  await notion.updateNotionTask("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", {
    title: "Updated",
    type: "Task",
    status: "In progress",
    priority: "",
    area: "",
    course: "",
    dueDate: "",
    nextAction: "",
  });

  const properties = updateBody.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties.Priority, { select: null });
  assert.deepEqual(properties.Area, { select: null });
  assert.deepEqual(properties.Course, { select: null });
  assert.deepEqual(properties.Date, { date: null });
  assert.deepEqual(properties["Next Action"], { rich_text: [] });
});

test("archives a task instead of permanently deleting it", async () => {
  let archiveBody: Record<string, unknown> = {};
  mockNotion({}, (url, init, body) => {
    assert.ok(url.endsWith("/pages/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"));
    assert.equal(init.method, "PATCH");
    archiveBody = body;
  });

  await notion.archiveNotionTask("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.deepEqual(archiveBody, { archived: true });
});

test("rejects invalid Notion IDs before making a request", async () => {
  await assert.rejects(
    notion.archiveNotionTask("not-a-page-id"),
    (error: unknown) => error instanceof Error && /valid planner item ID/.test(error.message),
  );
});
