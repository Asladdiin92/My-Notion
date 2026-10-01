import type { Task } from "@/lib/types";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

type NotionValue = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string } | null;
  status?: { name?: string } | null;
  multi_select?: Array<{ name?: string }>;
  date?: { start?: string } | null;
  checkbox?: boolean;
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
  number?: number | null;
};

type NotionPage = {
  id: string;
  url: string;
  created_time: string;
  properties: Record<string, NotionValue>;
};

type NotionQueryResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
};

type NotionPropertySchema = {
  type?: string;
  title?: Record<string, never>;
  rich_text?: Record<string, never>;
  select?: { options?: Array<{ name: string }> };
  status?: { options?: Array<{ name: string }> };
  number?: Record<string, never>;
  date?: Record<string, never>;
  checkbox?: Record<string, never>;
};

type NotionDatabase = {
  properties: Record<string, NotionPropertySchema>;
};

export type CreateTaskInput = {
  title: string;
  type?: string;
  status?: string;
  priority?: string;
  area?: string;
  course?: string;
  courseCode?: string;
  estimatedHours?: number | null;
  assessment?: string;
  dueDate?: string;
  nextAction?: string;
};

export type TaskOptions = Awaited<ReturnType<typeof fetchNotionTaskOptions>>;

function notionToken(): string {
  const token = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("Add NOTION_API_KEY (or NOTION_TOKEN) and NOTION_DATABASE_ID to .env.local, then restart the dev server.");
  }
  return token;
}

function notionDatabaseId(): string {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    throw new Error("Add NOTION_DATABASE_ID to .env.local, then restart the dev server.");
  }
  return databaseId;
}

function notionHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionError(response: Response): Promise<Error> {
  const details = await response.json().catch(() => null) as { message?: string; code?: string } | null;
  if (response.status === 401) return new Error("Notion rejected the integration token. Check NOTION_API_KEY in .env.local.");
  if (response.status === 404) return new Error("Notion could not find this database. Check NOTION_DATABASE_ID and share the database with your integration.");
  return new Error(`Notion API error${details?.code ? ` (${details.code})` : ""}: ${details?.message ?? response.statusText}`);
}

async function fetchDatabase(): Promise<NotionDatabase> {
  const token = notionToken();
  const response = await fetch(`${NOTION_API}/databases/${encodeURIComponent(notionDatabaseId())}`, {
    headers: notionHeaders(token),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw await notionError(response);
  return await response.json() as NotionDatabase;
}

function configuredProperty(properties: Record<string, NotionValue>, variable: string, fallback: string): string | undefined {
  const name = process.env[variable] || fallback;
  if (properties[name]) return name;
  const value = Object.entries(properties).find(([, property]) => property.type === fallback);
  return value?.[0];
}

function schemaProperty(properties: Record<string, NotionPropertySchema>, variable: string, fallback: string): string | undefined {
  const name = process.env[variable] || fallback;
  if (properties[name]) return name;
  const value = Object.entries(properties).find(([, property]) => property.type === fallback);
  return value?.[0];
}

function optionsFor(
  properties: Record<string, NotionPropertySchema>,
  variable: string,
  fallback: string,
): string[] {
  const name = schemaProperty(properties, variable, fallback);
  if (!name) return [];
  const property = properties[name];
  return (property.select?.options ?? property.status?.options ?? []).map((option) => option.name);
}

export async function fetchNotionTaskOptions() {
  const { properties } = await fetchDatabase();
  return {
    types: optionsFor(properties, "NOTION_TYPE_PROPERTY", "Type"),
    statuses: optionsFor(properties, "NOTION_STATUS_PROPERTY", "Status"),
    priorities: optionsFor(properties, "NOTION_PRIORITY_PROPERTY", "Priority"),
    areas: optionsFor(properties, "NOTION_AREA_PROPERTY", "Area"),
    courses: optionsFor(properties, "NOTION_COURSE_PROPERTY", "Course"),
    assessments: optionsFor(properties, "NOTION_ASSESSMENT_PROPERTY", "Assessment"),
  };
}

function addChoiceProperty(
  target: Record<string, unknown>,
  properties: Record<string, NotionPropertySchema>,
  variable: string,
  fallback: string,
  value: string | undefined,
  kind: "select" | "status",
): void {
  if (!value) return;
  const name = schemaProperty(properties, variable, fallback);
  if (!name || properties[name]?.type !== kind) {
    throw new Error(`The Notion database does not have a ${kind} property named "${process.env[variable] || fallback}".`);
  }
  const options = kind === "status" ? properties[name]?.status?.options : properties[name]?.select?.options;
  if (!options?.some((option) => option.name === value)) {
    throw new Error(`"${value}" is not an available option for ${name}. Refresh the dashboard and choose an option from the list.`);
  }
  target[name] = kind === "status" ? { status: { name: value } } : { select: { name: value } };
}

function defaultChoice(
  properties: Record<string, NotionPropertySchema>,
  variable: string,
  fallback: string,
  preferred: string[],
  kind: "select" | "status",
): string | undefined {
  const name = schemaProperty(properties, variable, fallback);
  if (!name || properties[name]?.type !== kind) return undefined;
  const options = kind === "status" ? properties[name]?.status?.options : properties[name]?.select?.options;
  const available = options?.map((option) => option.name) ?? [];
  return preferred.find((choice) => available.includes(choice)) ?? available[0];
}

function taskProperties(
  schema: Record<string, NotionPropertySchema>,
  input: CreateTaskInput,
  clearEmptyOptional: boolean,
): Record<string, unknown> {
  const title = input.title.trim();
  if (!title || title.length > 2000) throw new Error("Enter a title between 1 and 2,000 characters.");

  const titleName = schemaProperty(schema, "NOTION_TITLE_PROPERTY", "title");
  if (!titleName || schema[titleName]?.type !== "title") {
    throw new Error("The Notion database needs a title property. Check NOTION_TITLE_PROPERTY.");
  }
  const properties: Record<string, unknown> = {
    [titleName]: { title: [{ text: { content: title } }] },
  };

  const type = input.type?.trim() || defaultChoice(schema, "NOTION_TYPE_PROPERTY", "Type", ["Deliverable", "Task"], "select");
  const status = input.status?.trim() || defaultChoice(schema, "NOTION_STATUS_PROPERTY", "Status", ["Planned", "Not started"], "status");
  const priority = input.priority?.trim() || (!clearEmptyOptional
    ? defaultChoice(schema, "NOTION_PRIORITY_PROPERTY", "Priority", ["Medium", "Normal", "Low"], "select")
    : undefined);
  if (!type) throw new Error("Add at least one option to the Notion Type property.");
  if (!status) throw new Error("Add at least one option to the Notion Status property.");

  addChoiceProperty(properties, schema, "NOTION_TYPE_PROPERTY", "Type", type, "select");
  addChoiceProperty(properties, schema, "NOTION_STATUS_PROPERTY", "Status", status, "status");
  addChoiceProperty(properties, schema, "NOTION_PRIORITY_PROPERTY", "Priority", priority, "select");
  addChoiceProperty(properties, schema, "NOTION_AREA_PROPERTY", "Area", input.area, "select");
  addChoiceProperty(properties, schema, "NOTION_COURSE_PROPERTY", "Course", input.course, "select");
  addChoiceProperty(properties, schema, "NOTION_ASSESSMENT_PROPERTY", "Assessment", input.assessment, "select");
  addTextProperty(properties, schema, "NOTION_COURSE_CODE_PROPERTY", "Course Code", input.courseCode);
  addTextProperty(properties, schema, "NOTION_NEXT_ACTION_PROPERTY", "Next Action", input.nextAction);
  if (input.estimatedHours !== undefined && input.estimatedHours !== null) {
    const name = schemaProperty(schema, "NOTION_ESTIMATED_HOURS_PROPERTY", "Est.");
    if (!name || schema[name]?.type !== "number") {
      throw new Error(`The Notion database does not have a number property named "${process.env.NOTION_ESTIMATED_HOURS_PROPERTY || "Est."}".`);
    }
    if (!Number.isFinite(input.estimatedHours) || input.estimatedHours < 0 || input.estimatedHours > 10000) {
      throw new Error("Estimated hours must be a number between 0 and 10,000.");
    }
    properties[name] = { number: input.estimatedHours };
  }

  if (clearEmptyOptional) {
    clearChoiceProperty(properties, schema, "NOTION_PRIORITY_PROPERTY", "Priority", input.priority);
    clearChoiceProperty(properties, schema, "NOTION_AREA_PROPERTY", "Area", input.area);
    clearChoiceProperty(properties, schema, "NOTION_COURSE_PROPERTY", "Course", input.course);
    clearChoiceProperty(properties, schema, "NOTION_ASSESSMENT_PROPERTY", "Assessment", input.assessment);
    clearTextProperty(properties, schema, "NOTION_COURSE_CODE_PROPERTY", "Course Code", input.courseCode);
    clearTextProperty(properties, schema, "NOTION_NEXT_ACTION_PROPERTY", "Next Action", input.nextAction);
    if (input.estimatedHours === null) {
      const name = schemaProperty(schema, "NOTION_ESTIMATED_HOURS_PROPERTY", "Est.");
      if (name && schema[name]?.type === "number") properties[name] = { number: null };
    }
  }

  const dateName = schemaProperty(schema, "NOTION_DUE_DATE_PROPERTY", "Date");
  if (input.dueDate?.trim()) {
    validateDueDate(input.dueDate);
    if (!dateName || schema[dateName]?.type !== "date") {
      throw new Error(`The Notion database does not have a date property named "${process.env.NOTION_DUE_DATE_PROPERTY || "Date"}".`);
    }
    properties[dateName] = { date: { start: input.dueDate } };
  } else if (clearEmptyOptional && dateName && schema[dateName]?.type === "date") {
    properties[dateName] = { date: null };
  }

  return properties;
}

function clearChoiceProperty(
  target: Record<string, unknown>,
  schema: Record<string, NotionPropertySchema>,
  variable: string,
  fallback: string,
  value: string | undefined,
): void {
  if (value?.trim()) return;
  const name = schemaProperty(schema, variable, fallback);
  if (name && schema[name]?.type === "select") target[name] = { select: null };
}

function clearTextProperty(
  target: Record<string, unknown>,
  schema: Record<string, NotionPropertySchema>,
  variable: string,
  fallback: string,
  value: string | undefined,
): void {
  if (value?.trim()) return;
  const name = schemaProperty(schema, variable, fallback);
  if (name && schema[name]?.type === "rich_text") target[name] = { rich_text: [] };
}

function validateDueDate(value: string): void {
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const validDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const parsedDate = new Date(validDate ? `${value}T00:00:00.000Z` : value);
  const datePart = value.slice(0, 10);
  const parsedDatePart = new Date(`${datePart}T00:00:00.000Z`);
  if ((!validDate && !validDateTime) || Number.isNaN(parsedDate.getTime()) ||
      Number.isNaN(parsedDatePart.getTime()) || parsedDatePart.toISOString().slice(0, 10) !== datePart) {
    throw new Error("Choose a valid due date.");
  }
}

function addTextProperty(
  target: Record<string, unknown>,
  properties: Record<string, NotionPropertySchema>,
  variable: string,
  fallback: string,
  value: string | undefined,
): void {
  if (!value) return;
  const name = schemaProperty(properties, variable, fallback);
  if (!name || properties[name]?.type !== "rich_text") {
    throw new Error(`The Notion database does not have a text property named "${process.env[variable] || fallback}".`);
  }
  target[name] = { rich_text: [{ text: { content: value } }] };
}

export async function createNotionTask(input: CreateTaskInput): Promise<Task> {
  const token = notionToken();
  const databaseId = notionDatabaseId();
  const database = await fetchDatabase();
  validateInputLengths(input);
  const properties = taskProperties(database.properties, input, false);

  const response = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: notionHeaders(token),
    body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw await notionError(response);
  const page = await response.json() as NotionPage;
  return toTask(page);
}

export async function updateNotionTask(pageId: string, input: CreateTaskInput): Promise<Task> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pageId)) {
    throw new Error("Enter a valid planner item ID.");
  }
  validateInputLengths(input);
  const token = notionToken();
  const database = await fetchDatabase();
  const properties = taskProperties(database.properties, input, true);
  const response = await fetch(`${NOTION_API}/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    headers: notionHeaders(token),
    body: JSON.stringify({ properties }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw await notionError(response);
  return toTask(await response.json() as NotionPage);
}

export async function archiveNotionTask(pageId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pageId)) {
    throw new Error("Enter a valid planner item ID.");
  }
  const response = await fetch(`${NOTION_API}/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    headers: notionHeaders(notionToken()),
    body: JSON.stringify({ archived: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw await notionError(response);
}

function validateInputLengths(input: CreateTaskInput): void {
  for (const [label, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 2000) {
      throw new Error(`${label} must be 2,000 characters or fewer.`);
    }
  }
}

function text(value: NotionValue | undefined): string {
  if (!value) return "";
  if (value.title) return value.title.map((part) => part.plain_text ?? "").join("");
  if (value.rich_text) return value.rich_text.map((part) => part.plain_text ?? "").join("");
  if (value.select?.name) return value.select.name;
  if (value.status?.name) return value.status.name;
  if (value.multi_select) return value.multi_select.map((item) => item.name ?? "").filter(Boolean).join(", ");
  if (value.type === "url") return value.url ?? "";
  if (value.type === "email") return value.email ?? "";
  if (value.type === "phone_number") return value.phone_number ?? "";
  if (typeof value.number === "number") return String(value.number);
  return "";
}

function propertyText(properties: Record<string, NotionValue>, variable: string, fallback: string): string {
  const name = configuredProperty(properties, variable, fallback);
  return name ? text(properties[name]) : "";
}

function toTask(page: NotionPage): Task {
  const properties = page.properties ?? {};
  const titleProperty = configuredProperty(properties, "NOTION_TITLE_PROPERTY", "title")
    ?? Object.keys(properties).find((name) => properties[name]?.type === "title");
  const status = propertyText(properties, "NOTION_STATUS_PROPERTY", "Status") || "Not started";
  const completedName = configuredProperty(properties, "NOTION_COMPLETED_PROPERTY", "Completed");
  const checkboxCompleted = completedName ? properties[completedName]?.checkbox === true : false;
  const done = /^(done|complete|completed|finished)$/i.test(status.trim());
  const dueDateProperty = configuredProperty(properties, "NOTION_DUE_DATE_PROPERTY", "Date");
  const dueDate = dueDateProperty ? properties[dueDateProperty]?.date?.start ?? null : null;

  return {
    id: page.id,
    url: page.url,
    title: (titleProperty ? text(properties[titleProperty]) : "") || "Untitled item",
    status,
    priority: propertyText(properties, "NOTION_PRIORITY_PROPERTY", "Priority") || "Unassigned",
    type: propertyText(properties, "NOTION_TYPE_PROPERTY", "Type") || "Other",
    area: propertyText(properties, "NOTION_AREA_PROPERTY", "Area") || "Unassigned",
    course: propertyText(properties, "NOTION_COURSE_PROPERTY", "Course"),
    courseCode: propertyText(properties, "NOTION_COURSE_CODE_PROPERTY", "Course Code"),
    estimatedHours: (() => {
      const name = configuredProperty(properties, "NOTION_ESTIMATED_HOURS_PROPERTY", "Est.");
      const value = name ? properties[name]?.number : null;
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    })(),
    assessment: propertyText(properties, "NOTION_ASSESSMENT_PROPERTY", "Assessment"),
    nextAction: propertyText(properties, "NOTION_NEXT_ACTION_PROPERTY", "Next Action"),
    dueDate,
    createdAt: page.created_time,
    completed: checkboxCompleted || done,
  };
}

export async function fetchNotionTasks(): Promise<Task[]> {
  const token = notionToken();
  const databaseId = notionDatabaseId();

  const tasks: Task[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const response = await fetch(`${NOTION_API}/databases/${encodeURIComponent(databaseId)}/query`, {
      method: "POST",
      headers: notionHeaders(token),
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw await notionError(response);
    }

    const data = await response.json() as NotionQueryResponse;
    tasks.push(...data.results.map(toTask));
    if (!data.has_more || !data.next_cursor) return tasks;
    cursor = data.next_cursor;
  }

  throw new Error("The database has more than 2,000 entries. Add a database filter or narrow the dashboard query.");
}
