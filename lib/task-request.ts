import type { CreateTaskInput } from "@/lib/notion";

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")]
    .flatMap((value) => value?.split(",").map((host) => host.trim()) ?? []);
  if (!origin || hosts.length === 0) return false;
  try {
    return hosts.includes(new URL(origin).host);
  } catch {
    return false;
  }
}

export async function parseTaskInput(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false as const, error: "Enter a planner item." };
    }
    const values = body as Record<string, unknown>;
    const allowedFields = new Set([
      "title", "type", "status", "priority", "area", "course", "courseCode",
      "estimatedHours", "actualHours", "assessment", "creditHours", "instructor",
      "marksGrade", "nextReviewDate", "notes", "recurrence", "resourceLink",
      "semester", "timeBlock", "venueLink", "dueDate", "dateEnd", "deliverable",
      "nextAction",
    ]);
    if (Object.keys(values).some((key) => !allowedFields.has(key))) {
      return { ok: false as const, error: "The request contains an unsupported field." };
    }
    if (typeof values.title !== "string" || !values.title.trim()) {
      return { ok: false as const, error: "A task title is required." };
    }
    for (const name of [
      "type", "status", "priority", "area", "course", "courseCode", "assessment",
      "instructor", "marksGrade", "nextReviewDate", "notes", "recurrence",
      "resourceLink", "semester", "timeBlock", "venueLink", "dueDate", "dateEnd",
      "nextAction",
    ] as const) {
      if (values[name] !== undefined && (typeof values[name] !== "string" || values[name].length > 2000)) {
        return { ok: false as const, error: `Invalid ${name} value.` };
      }
    }
    if (values.estimatedHours !== undefined && values.estimatedHours !== null &&
        (typeof values.estimatedHours !== "number" || !Number.isFinite(values.estimatedHours) ||
         values.estimatedHours < 0 || values.estimatedHours > 10000)) {
      return { ok: false as const, error: "Estimated hours must be a number between 0 and 10,000." };
    }
    for (const name of ["actualHours", "creditHours"] as const) {
      if (values[name] !== undefined && values[name] !== null &&
          (typeof values[name] !== "number" || !Number.isFinite(values[name]) ||
           values[name] < 0 || values[name] > 10000)) {
        return { ok: false as const, error: `${name} must be a number between 0 and 10,000.` };
      }
    }
    if (values.deliverable !== undefined && typeof values.deliverable !== "boolean") {
      return { ok: false as const, error: "Deliverable must be true or false." };
    }
    if (values.title.length > 2000) {
      return { ok: false as const, error: "Title must be 2,000 characters or fewer." };
    }
    // Validate date format for dueDate, dateEnd, and nextReviewDate.
    // Without this, a malformed date string passes all string checks and reaches
    // the Notion API, which returns an opaque 400 instead of a clean validation error.
    for (const name of ["dueDate", "dateEnd", "nextReviewDate"] as const) {
      const v = values[name];
      if (typeof v !== "string" || !v) continue;
      const datePart = v.slice(0, 10);
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
      const isDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v);
      const isLocalDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
      if (!isDateOnly && !isDateTime && !isLocalDateTime) {
        return { ok: false as const, error: `${name} must be a date in YYYY-MM-DD or ISO 8601 format.` };
      }
      const parsed = new Date(`${datePart}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== datePart) {
        return { ok: false as const, error: `${name} is not a valid calendar date.` };
      }
    }
    const input: CreateTaskInput = {
      title: values.title,
      type: values.type as string | undefined,
      status: values.status as string | undefined,
      priority: values.priority as string | undefined,
      area: values.area as string | undefined,
      course: values.course as string | undefined,
      courseCode: values.courseCode as string | undefined,
      estimatedHours: values.estimatedHours as number | null | undefined,
      actualHours: values.actualHours as number | null | undefined,
      assessment: values.assessment as string | undefined,
      creditHours: values.creditHours as number | null | undefined,
      instructor: values.instructor as string | undefined,
      marksGrade: values.marksGrade as string | undefined,
      nextReviewDate: values.nextReviewDate as string | undefined,
      notes: values.notes as string | undefined,
      recurrence: values.recurrence as string | undefined,
      resourceLink: values.resourceLink as string | undefined,
      semester: values.semester as string | undefined,
      timeBlock: values.timeBlock as string | undefined,
      venueLink: values.venueLink as string | undefined,
      dueDate: values.dueDate as string | undefined,
      dateEnd: values.dateEnd as string | undefined,
      deliverable: values.deliverable as boolean | undefined,
      nextAction: values.nextAction as string | undefined,
    };
    return { ok: true as const, input };
  } catch {
    return { ok: false as const, error: "Send a valid JSON planner item." };
  }
}
