import { NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import {
  type DayPlanPreferences,
  getPlannerAssistantAnswer,
  getPlannerAssistantBreakdown,
  getPlannerAssistantDayPlan,
  getPlannerDatabaseDraft,
  getPlannerFileAnalysis,
  getPlannerAssistantPlan,
  getPlannerResearchAnswer,
  getPlannerTranslation,
  getPlannerWritingAnswer,
} from "@/lib/gemini";
import { fetchNotionTaskOptions, fetchNotionTasks } from "@/lib/notion";
import { convertPrayerTimesToTimezone, fetchHararPrayerTimes } from "@/lib/prayer-times";
import { isSameOrigin } from "@/lib/task-request";
import { PLANNER_TIME_ZONE } from "@/lib/planner-datetime";
import { extractAssistantFile } from "@/lib/assistant-files";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to use this planner." }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  const multipart = request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data") ?? false;
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return NextResponse.json({ error: "The assistant request has an invalid size." }, { status: 400 });
  }
  if (contentLength > (multipart ? 4 * 1024 * 1024 : 40 * 1024)) {
    return NextResponse.json({ error: "The assistant request is too large. File uploads are limited to 3 MB." }, { status: 413 });
  }

  let values: Record<string, unknown>;
  let uploadedFile: Awaited<ReturnType<typeof extractAssistantFile>> | undefined;
  if (multipart) {
    try {
      const form = await request.formData();
      const allowedFormFields = new Set(["mode", "question", "language", "sourceLanguage", "file"]);
      if (Array.from(form.keys()).some((key) => !allowedFormFields.has(key)) ||
          ["mode", "question", "language", "sourceLanguage"].some((key) => form.getAll(key).length > 1)) {
        return NextResponse.json({ error: "The assistant upload contains unsupported or duplicate fields." }, { status: 400 });
      }
      values = Object.fromEntries(["mode", "question", "language", "sourceLanguage"].flatMap((name) => {
        const value = form.get(name);
        return typeof value === "string" ? [[name, value]] : [];
      }));
      const files = form.getAll("file");
      if (files.length !== 1 || typeof files[0] === "string") {
        return NextResponse.json({ error: "Choose exactly one file to analyze." }, { status: 400 });
      }
      uploadedFile = await extractAssistantFile(files[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The uploaded file could not be read.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } else {
    if (contentLength > 40 * 1024) {
      return NextResponse.json({ error: "The assistant request is too large." }, { status: 413 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Send a valid assistant request." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Send a valid assistant request." }, { status: 400 });
    }
    values = body as Record<string, unknown>;
  }

  if (Object.keys(values).some((key) => !["mode", "question", "date", "timezone", "taskId", "planning", "language", "sourceLanguage"].includes(key))) {
    return NextResponse.json({ error: "The request contains an unsupported field." }, { status: 400 });
  }
  const modes = ["suggest", "ask", "plan", "breakdown", "day", "research", "writing", "translate", "analyze", "autofill"];
  if (typeof values.mode !== "string" || !modes.includes(values.mode)) {
    return NextResponse.json({ error: "Choose a valid assistant action." }, { status: 400 });
  }
  if (multipart && values.mode !== "analyze" && values.mode !== "autofill") {
    return NextResponse.json({ error: "Files can only be used for file analysis or database autofill." }, { status: 400 });
  }
  if ((["ask", "plan", "research", "writing", "translate", "analyze", "autofill"].includes(values.mode)) &&
      (typeof values.question !== "string" || !values.question.trim())) {
    return NextResponse.json({ error: "Enter an instruction or question for your planner." }, { status: 400 });
  }
  const questionLimit = values.mode === "translate" ? 8000 : values.mode === "writing" || values.mode === "autofill" ? 2000 : 1000;
  if (values.question !== undefined &&
      (typeof values.question !== "string" || values.question.length > questionLimit)) {
    return NextResponse.json({ error: `Instructions must be ${questionLimit.toLocaleString()} characters or fewer.` }, { status: 400 });
  }
  if (values.mode === "analyze" && !uploadedFile) {
    return NextResponse.json({ error: "Upload a supported file to analyze." }, { status: 400 });
  }
  if (values.mode === "translate" &&
      (typeof values.language !== "string" || !values.language.trim() || values.language.length > 80 ||
       (values.sourceLanguage !== undefined && (typeof values.sourceLanguage !== "string" || values.sourceLanguage.length > 80)))) {
    return NextResponse.json({ error: "Choose a valid target language for translation." }, { status: 400 });
  }
  if (values.taskId !== undefined &&
      (typeof values.taskId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.taskId))) {
    return NextResponse.json({ error: "Choose a valid planner task." }, { status: 400 });
  }
  if (values.mode === "day" || values.date !== undefined || values.timezone !== undefined) {
    if (typeof values.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) ||
        typeof values.timezone !== "string" || values.timezone.length > 100) {
      return NextResponse.json({ error: "A valid local date and time zone are required for this planner request." }, { status: 400 });
    }
    const parsedDate = new Date(`${values.date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== values.date) {
      return NextResponse.json({ error: "Choose a valid date for your day plan." }, { status: 400 });
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: values.timezone }).format();
    } catch {
      return NextResponse.json({ error: "Choose a valid time zone for your day plan." }, { status: 400 });
    }
  }
  let dayPreferences: DayPlanPreferences = {
    availableHours: 6,
    studyStart: "08:30",
    studyEnd: "18:00",
    selectedAreas: [],
    selectedCourses: [],
    energyLevel: "medium",
    instructions: "",
  };
  if (values.mode === "day") {
    const planning = values.planning;
    if (!planning || typeof planning !== "object" || Array.isArray(planning)) {
      return NextResponse.json({ error: "Provide valid daily planning preferences." }, { status: 400 });
    }
    const fields = planning as Record<string, unknown>;
    if (Object.keys(fields).some((key) => !["availableHours", "studyStart", "studyEnd", "selectedAreas", "selectedCourses", "energyLevel", "instructions"].includes(key)) ||
        typeof fields.availableHours !== "number" || !Number.isFinite(fields.availableHours) ||
        fields.availableHours < 0.5 || fields.availableHours > 12 ||
        typeof fields.studyStart !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.studyStart) ||
        typeof fields.studyEnd !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.studyEnd) ||
        fields.studyStart < "08:30" || fields.studyEnd > "18:00" || fields.studyStart >= fields.studyEnd ||
        !Array.isArray(fields.selectedAreas) || fields.selectedAreas.length > 20 ||
        fields.selectedAreas.some((value) => typeof value !== "string" || value.length > 100) ||
        !Array.isArray(fields.selectedCourses) || fields.selectedCourses.length > 30 ||
        fields.selectedCourses.some((value) => typeof value !== "string" || value.length > 100) ||
        !["low", "medium", "high"].includes(fields.energyLevel as string) ||
        typeof fields.instructions !== "string" || fields.instructions.length > 500) {
      return NextResponse.json({ error: "Check your available hours, work window, areas, courses, and instructions." }, { status: 400 });
    }
    dayPreferences = {
      availableHours: fields.availableHours,
      studyStart: fields.studyStart,
      studyEnd: fields.studyEnd,
      selectedAreas: fields.selectedAreas as string[],
      selectedCourses: fields.selectedCourses as string[],
      energyLevel: fields.energyLevel as DayPlanPreferences["energyLevel"],
      instructions: fields.instructions,
    };
    if (values.timezone !== PLANNER_TIME_ZONE) {
      return NextResponse.json({ error: `Daily planning currently uses ${PLANNER_TIME_ZONE}.` }, { status: 400 });
    }
  }

  try {
    const needsPlannerData = ["suggest", "ask", "plan", "breakdown", "day", "autofill"].includes(values.mode as string);
    const tasks = needsPlannerData ? await fetchNotionTasks() : [];
    if (values.mode === "plan") {
      const options = await fetchNotionTaskOptions();
      const plan = await getPlannerAssistantPlan(
        values.question as string,
        tasks,
        options,
        values.date as string | undefined,
        values.timezone as string | undefined,
      );
      return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
    }
    if (values.mode === "breakdown") {
      const plan = await getPlannerAssistantBreakdown(tasks, values.taskId as string | undefined);
      return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
    }
    if (values.mode === "day") {
      const options = await fetchNotionTaskOptions();
      if (dayPreferences.selectedAreas.some((area) => !options.areas.includes(area)) ||
          dayPreferences.selectedCourses.some((course) => !options.courses.includes(course))) {
        return NextResponse.json({ error: "Choose areas and courses from your Notion database options." }, { status: 400 });
      }
      const prayerData = await fetchHararPrayerTimes(values.date as string);
      const prayerTimes = convertPrayerTimesToTimezone(
        prayerData.date,
        prayerData.timezone,
        values.timezone as string,
        prayerData.times,
      );
      const plan = await getPlannerAssistantDayPlan(tasks, values.date as string, values.timezone as string, prayerTimes, dayPreferences);
      return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
    }
    if (values.mode === "research") {
      const research = await getPlannerResearchAnswer(values.question as string);
      return NextResponse.json(research, { headers: { "Cache-Control": "no-store" } });
    }
    if (values.mode === "writing") {
      const answer = await getPlannerWritingAnswer(values.question as string);
      return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
    }
    if (values.mode === "translate") {
      const answer = await getPlannerTranslation(
        values.question as string,
        values.language as string,
        values.sourceLanguage as string | undefined,
      );
      return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
    }
    if (values.mode === "analyze") {
      const answer = await getPlannerFileAnalysis(uploadedFile!, values.question as string);
      return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
    }
    if (values.mode === "autofill") {
      const options = await fetchNotionTaskOptions();
      const plan = await getPlannerDatabaseDraft(values.question as string, uploadedFile, tasks, options);
      return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
    }
    const answer = await getPlannerAssistantAnswer(values.mode as "suggest" | "ask", values.question as string | undefined, tasks);
    return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The planner assistant could not respond.";
    const status = message.startsWith("Add GEMINI_API_KEY") ||
      message.startsWith("Add NOTION_") ||
      message.startsWith("Add TAVILY_API_KEY") ? 503 : 502;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
