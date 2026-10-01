"use client";

import { useUser, UserButton } from "@clerk/nextjs";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Columns3,
  ExternalLink,
  Flame,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  LucideIcon,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  PriorityChart,
  StatusChart,
  TimelineChart,
  TypeChart,
} from "@/components/dashboard-charts";
import { PlannerAssistant } from "@/components/planner-assistant";
import type { Task, TaskOptions, TasksResponse } from "@/lib/types";

type LoadState = "loading" | "ready" | "error";
type TaskMutationResponse = { ok: boolean; task?: Task; error?: string };

const isoToday = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function formatDate(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  const hasTime = value.includes("T");
  const formatOptions = hasTime
    ? { ...options, hour: "numeric" as const, minute: "2-digit" as const }
    : options;
  const date = hasTime ? new Date(value) : new Date(`${value.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("en", formatOptions).format(date);
}

function dateTimeLocalValue(value: string) {
  if (!value.includes("T")) return `${value.slice(0, 10)}T00:00`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function countBy(tasks: Task[], select: (task: Task) => string) {
  const counts = new Map<string, number>();
  tasks.forEach((task) => {
    const name = select(task).trim() || "Other";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function getTimeline(tasks: Task[]) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 5 + index, 1));
  const counts = months.map((month) => {
    const key = `${month.getFullYear()}-${month.getMonth()}`;
    const count = tasks.filter((task) => {
      const created = new Date(task.createdAt);
      return `${created.getFullYear()}-${created.getMonth()}` === key;
    }).length;
    return { month: new Intl.DateTimeFormat("en", { month: "short" }).format(month), count };
  });
  return counts;
}

function isOverdue(task: Task, today: string) {
  return !task.completed && Boolean(task.dueDate) && task.dueDate!.slice(0, 10) < today;
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const navigation = [
    { label: "Overview", icon: LayoutDashboard, target: "overview" },
    { label: "My tasks", icon: ListChecks, target: "tasks" },
    { label: "Calendar", icon: CalendarDays, target: "calendar" },
    { label: "Progress", icon: Target, target: "progress" },
    { label: "AI planner", icon: Sparkles, target: "planner-assistant" },
  ];
  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={onClose}>
        <span className="brand-mark">n</span>
        <span className="brand-copy"><strong>My Workspace</strong><small>Academic &amp; life planner</small></span>
      </a>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {navigation.map(({ label, icon: Icon, target }, index) => (
          <a className={`nav-link${index === 0 ? " active" : ""}`} href={`#${target}`} onClick={onClose} key={label}>
            <Icon size={16} strokeWidth={1.8} /><span>{label}</span>
            {label === "My tasks" && <span className="nav-badge">↗</span>}
          </a>
        ))}
      </nav>
      <div className="sidebar-label projects-label">YOUR DATABASE</div>
      <div className="database-link"><span className="database-icon"><BookOpen size={14} /></span><span>Academic &amp; Life Planner</span></div>
      <div className="sidebar-bottom">
        <div className="notion-status"><span className="status-indicator" /><span>Powered by your Notion database</span></div>
        <div className="profile-row"><span className="profile-avatar">A</span><span><strong>Asladin</strong><small>Personal workspace</small></span><Sparkles size={15} className="profile-sparkle" /></div>
      </div>
    </aside>
  );
}

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  tone,
  trend,
}: {
  label: string;
  value: number | string;
  note: string;
  icon: LucideIcon;
  tone: string;
  trend?: "up" | "down";
}) {
  return (
    <article className="metric-card">
      <div className="metric-head"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={16} strokeWidth={1.9} /></span></div>
      <div className="metric-value-row"><strong className="metric-value">{value}</strong>{trend && <span className="metric-trend">{trend === "up" ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{note}</span>}</div>
      {!trend && <div className="metric-note">{note}</div>}
    </article>
  );
}

function TaskDialog({
  options,
  task,
  onClose,
  onSaved,
}: {
  options: TaskOptions;
  task: Task | null;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const hasChoices = options.types.length > 0 && options.statuses.length > 0;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    const dueDate = String(values.dueDate ?? "");
    const dueTime = String(values.dueTime ?? "");
    const localDueDate = dueDate && dueTime
      ? new Date(`${dueDate}T${dueTime}`).toISOString()
      : dueDate;
    const estimatedHours = String(values.estimatedHours ?? "");
    const taskValues = Object.fromEntries(Object.entries(values).filter(([name]) => name !== "dueTime"));
    const body = {
      ...taskValues,
      dueDate: localDueDate,
      estimatedHours: estimatedHours === "" ? null : Number(estimatedHours),
    };

    try {
      const response = await fetch(task ? `/api/tasks/${encodeURIComponent(task.id)}` : "/api/tasks", {
        method: task ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as TaskMutationResponse;
      if (!response.ok || !result.ok || !result.task) {
        throw new Error(result.error ?? "Could not create the planner item.");
      }
      onSaved(result.task);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create the planner item.");
    } finally {
      setSaving(false);
    }
  }

  function choiceField(name: string, label: string, values: string[], preferred?: string, required = false, emptyLabel = "None") {
    const taskValue = task ? task[name as keyof Task] : undefined;
    const selected = task
      ? typeof taskValue === "string" && values.includes(taskValue) ? taskValue : ""
      : values.includes(preferred ?? "") ? preferred : values[0];
    return (
      <label className="create-field" key={name}>
        <span>{label}{required && <i> *</i>}</span>
        <select name={name} defaultValue={selected ?? ""} required={required && values.length > 0} disabled={values.length === 0}>
          {values.length === 0 && <option value="">No options available</option>}
          {!required && <option value="">{emptyLabel}</option>}
          {values.map((value) => <option value={value} key={value}>{value}</option>)}
        </select>
      </label>
    );
  }

  return (
    <dialog ref={dialogRef} className="create-dialog" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="create-form" onSubmit={submitTask}>
        <div className="create-dialog-heading">
          <div><span className="create-dialog-icon">{task ? <Pencil size={16} /> : <Plus size={17} />}</span><div><h2>{task ? "Edit planner item" : "New planner item"}</h2><p>{task ? "Update this item in your Notion database." : "Add it directly to your Notion database."}</p></div></div>
          <button type="button" className="create-dialog-close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        <label className="create-field create-title-field">
          <span>Title <i>*</i></span>
          <input name="title" defaultValue={task?.title ?? ""} maxLength={2000} placeholder="What do you need to get done?" required autoFocus />
        </label>
        <div className="create-fields-grid">
          {choiceField("type", "Type", options.types, "Deliverable", true)}
          {choiceField("status", "Status", options.statuses, "Planned", true)}
          {choiceField("priority", "Priority", options.priorities, "Medium", false, "Use default")}
          {choiceField("area", "Area", options.areas)}
          {choiceField("course", "Course", options.courses)}
          {choiceField("assessment", "Assessment", options.assessments)}
          <label className="create-field"><span>Course code</span><input name="courseCode" defaultValue={task?.courseCode ?? ""} maxLength={2000} placeholder="e.g. ITeC4133" /></label>
          <label className="create-field"><span>Estimated hours</span><input name="estimatedHours" type="number" min="0" max="10000" step="0.25" defaultValue={task?.estimatedHours ?? ""} /></label>
          <label className="create-field"><span>Due date</span><input name="dueDate" type="date" defaultValue={task?.dueDate?.slice(0, 10) ?? ""} /></label>
          <label className="create-field"><span>Due time</span><input name="dueTime" type="time" defaultValue={task?.dueDate?.includes("T") ? dateTimeLocalValue(task.dueDate).slice(11, 16) : ""} /></label>
        </div>
        <label className="create-field next-action-field">
          <span>Next action</span>
          <textarea name="nextAction" defaultValue={task?.nextAction ?? ""} maxLength={2000} rows={2} placeholder="What is the next concrete step?" />
        </label>
        {!hasChoices && <p className="create-form-notice">Type and Status options could not be loaded. Check that these properties exist in your Notion database.</p>}
        {error && <p className="create-form-error" role="alert">{error}</p>}
        <div className="create-dialog-actions">
          <button type="button" className="create-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="create-submit" disabled={saving || !hasChoices}>
            {saving ? <><LoaderCircle size={14} className="spin" /> Saving...</> : task ? <><Pencil size={14} /> Save changes</> : <><Plus size={14} /> Create item</>}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function CalendarCard({ tasks }: { tasks: Task[] }) {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const firstWeekday = (visibleMonth.getDay() + 6) % 7;
  const monthLength = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + monthLength) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= monthLength ? day : null;
  });
  const deadlines = new Map<string, Task[]>();
  tasks.forEach((task) => {
    if (!task.dueDate) return;
    const day = task.dueDate.slice(0, 10);
    deadlines.set(day, [...(deadlines.get(day) ?? []), task]);
  });
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(visibleMonth);
  const today = isoToday();

  return (
    <section className="panel calendar-panel" id="calendar">
      <div className="panel-heading">
        <div><h2>Deadline calendar</h2><p>Important dates, all in one place</p></div>
        <div className="calendar-controls">
          <button className="round-button" aria-label="Previous month" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
          <button className="round-button" aria-label="Next month" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="calendar-month">{monthLabel}<span className="calendar-current">Jump to this month</span></div>
      <div className="calendar-grid calendar-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid calendar-days">
        {cells.map((day, index) => {
          if (day === null) return <div className="calendar-day out-of-month" key={`blank-${index}`} />;
          const date = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dueTasks = deadlines.get(date) ?? [];
          return (
            <div className={`calendar-day${date === today ? " today" : ""}`} key={date} title={dueTasks.map((task) => task.title).join(", ")}>
              <span>{day}</span>{dueTasks.length > 0 && <i className="deadline-marker" aria-label={`${dueTasks.length} deadline${dueTasks.length > 1 ? "s" : ""}`} />}
            </div>
          );
        })}
      </div>
      <div className="calendar-legend"><span className="deadline-marker" /> Task deadline <span className="calendar-today-key" /> Today</div>
      <div className="upcoming-list">
        <div className="upcoming-heading">UPCOMING DEADLINES</div>
        {tasks.filter((task) => task.dueDate && !task.completed && task.dueDate.slice(0, 10) >= today)
          .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")).slice(0, 3).map((task) => (
            <div className="upcoming-item" key={task.id}>
              <span className="upcoming-date">{formatDate(task.dueDate!)}</span>
              <span className="upcoming-task">{task.title}</span>
              <span className="upcoming-type">{task.type}</span>
            </div>
          ))}
        {tasks.filter((task) => task.dueDate && !task.completed && task.dueDate.slice(0, 10) >= today).length === 0 && <p className="upcoming-empty">No upcoming deadlines. Enjoy the breathing room.</p>}
      </div>
    </section>
  );
}

function TaskTable({ tasks, options, loading, search, onSearch, onCreate, onEdit, onDelete, onBreakdown, createDisabled, deleting }: {
  tasks: Task[];
  options: TaskOptions | null;
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  onCreate: () => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onBreakdown: (task: Task) => void;
  createDisabled: boolean;
  deleting: boolean;
}) {
  const [activeFilter, setActiveFilter] = useState<"all" | "deliverables" | "routines" | "course">("all");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [view, setView] = useState<"table" | "board">("table");
  const today = isoToday();
  const searched = tasks.filter((task) => `${task.title} ${task.type} ${task.area} ${task.course} ${task.courseCode ?? ""} ${task.assessment ?? ""} ${task.status} ${task.priority}`.toLowerCase().includes(search.toLowerCase()));
  const isDeliverable = (task: Task) => /deliverable/i.test(task.type) || /lab|assignment|project/i.test(task.assessment ?? "");
  const isRoutine = (task: Task) => /routine|prayer/i.test(task.type);
  const deliverableCount = searched.filter(isDeliverable).length;
  const routineCount = searched.filter(isRoutine).length;
  const courseTasks = searched.filter((task) => Boolean(task.courseCode?.trim()));
  const courseCodes = Array.from(new Set(tasks.map((task) => task.courseCode?.trim()).filter((code): code is string => Boolean(code)))).sort();
  const filtered = searched.filter((task) => {
    if (activeFilter === "deliverables") return isDeliverable(task);
    if (activeFilter === "routines") return isRoutine(task);
    if (activeFilter === "course") return Boolean(task.courseCode?.trim()) && (!selectedCourse || task.courseCode?.trim() === selectedCourse);
    return true;
  });
  const boardStatuses = Array.from(new Set([
    ...(options?.statuses ?? []).filter((status) => !/^(done|complete|completed|finished)$/i.test(status)),
    ...tasks.map((task) => task.status).filter((status) => !/^(done|complete|completed|finished)$/i.test(status)),
    "Done",
  ]));

  function renderActions(task: Task) {
    return <div className="task-row-actions">
      <button type="button" aria-label={`Break down ${task.title}`} title="Break this task into steps" onClick={() => onBreakdown(task)} disabled={deleting || task.completed || createDisabled}><Sparkles size={13} /></button>
      <button type="button" aria-label={`Edit ${task.title}`} title="Edit task" onClick={() => onEdit(task)} disabled={deleting}><Pencil size={13} /></button>
      <button type="button" className="delete-task" aria-label={`Archive ${task.title}`} title="Archive task" onClick={() => onDelete(task)} disabled={deleting}>
        {deleting ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}
      </button>
    </div>;
  }

  return (
    <section className="panel task-panel" id="tasks">
      <div className="panel-heading task-panel-heading">
        <div><h2>Your tasks</h2><p>The latest from your Notion planner</p></div>
        <div className="task-actions">
          <label className="task-search"><Search size={14} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Filter tasks..." aria-label="Filter tasks" /></label>
          <div className="task-view-toggle" role="group" aria-label="Task view">
            <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button>
            <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}><Columns3 size={12} /> Board</button>
          </div>
          <button className="create-item-button" onClick={onCreate} type="button" disabled={createDisabled}><Plus size={13} /> New item</button>
        </div>
      </div>
      <div className="task-filter-row" role="tablist" aria-label="Filter task categories">
        <button type="button" role="tab" aria-selected={activeFilter === "all"} onClick={() => setActiveFilter("all")}>All <span>{searched.length}</span></button>
        <button type="button" role="tab" aria-selected={activeFilter === "deliverables"} onClick={() => setActiveFilter("deliverables")}>Deliverables <span>{deliverableCount}</span></button>
        <button type="button" role="tab" aria-selected={activeFilter === "routines"} onClick={() => setActiveFilter("routines")}>Routines &amp; Prayers <span>{routineCount}</span></button>
        <button type="button" role="tab" aria-selected={activeFilter === "course"} onClick={() => setActiveFilter("course")}>By Course <span>{courseTasks.length}</span></button>
        {activeFilter === "course" && <select aria-label="Filter by course code" value={selectedCourse} onChange={(event) => setSelectedCourse(event.target.value)}>
          <option value="">All course codes</option>
          {courseCodes.map((code) => <option value={code} key={code}>{code} ({tasks.filter((task) => task.courseCode?.trim() === code).length})</option>)}
        </select>}
      </div>
      {view === "table" ? <div className="task-table-scroll">
        <table className="task-table">
          <thead><tr><th>Task</th><th>Course code</th><th>Assessment</th><th>Est.</th><th>Type</th><th>Area</th><th>Priority</th><th>Status</th><th>Next action</th><th>Due date</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((task) => (
              <tr key={task.id}>
                <td><div className="task-title-cell"><span className={`task-state ${task.completed ? "is-complete" : ""}`}>{task.completed && <Check size={11} />}</span><a href={task.url} target="_blank" rel="noreferrer">{task.title}<ExternalLink size={10} /></a></div>{task.course && <span className="task-subtitle">{task.course}</span>}</td>
                <td>{task.courseCode ? <span className="course-code-pill">{task.courseCode}</span> : "—"}</td>
                <td>{task.assessment ? <span className={`pill assessment-pill ${task.assessment.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{task.assessment}</span> : "—"}</td>
                <td className="estimated-hours">{task.estimatedHours !== undefined ? <><Clock3 size={11} /> {task.estimatedHours}h</> : "—"}</td>
                <td><span className={`pill type-pill ${task.type.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{task.type}</span></td>
                <td><span className="area-value">{task.area}</span></td>
                <td><span className={`pill priority-pill ${task.priority.toLowerCase()}`}>{task.priority}</span></td>
                <td><span className={`pill status-pill ${task.completed ? "completed" : task.status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{task.completed ? "Completed" : task.status}</span></td>
                <td className="next-action" title={task.nextAction || undefined}>{task.nextAction || "—"}</td>
                <td className={`due-date${isOverdue(task, today) ? " overdue" : ""}`}>{task.dueDate ? <>{isOverdue(task, today) && <CircleAlert size={12} />}{formatDate(task.dueDate)}</> : "—"}</td>
                <td>{renderActions(task)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="table-message"><LoaderCircle size={17} className="spin" /> Loading your Notion tasks...</div>}
        {!loading && filtered.length === 0 && <div className="table-message">{search ? "No tasks match these filters." : "Your Notion database has no tasks yet."}</div>}
      </div> : <div className="task-board">
        {boardStatuses.map((status) => {
          const laneTasks = filtered.filter((task) => (task.completed ? "Done" : task.status) === status);
          return <section className="board-column" key={status}>
            <h3><span className={`board-status-dot ${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} />{status}<span>{laneTasks.length}</span></h3>
            {laneTasks.map((task) => <article className="board-task-card" key={task.id}>
              <a href={task.url} target="_blank" rel="noreferrer">{task.title}<ExternalLink size={10} /></a>
              <div className="board-task-meta">
                {task.courseCode && <span className="course-code-pill">{task.courseCode}</span>}
                {task.assessment && <span className={`pill assessment-pill ${task.assessment.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{task.assessment}</span>}
                {task.estimatedHours !== undefined && <span><Clock3 size={10} /> {task.estimatedHours}h</span>}
              </div>
              {task.dueDate && <p className={`board-task-date${isOverdue(task, today) ? " overdue" : ""}`}><CalendarDays size={11} />{formatDate(task.dueDate)}</p>}
              <div className="board-task-footer"><span className={`pill priority-pill ${task.priority.toLowerCase()}`}>{task.priority}</span>{renderActions(task)}</div>
            </article>)}
            {laneTasks.length === 0 && <p className="board-empty">No items</p>}
          </section>;
        })}
        {loading && <div className="table-message"><LoaderCircle size={17} className="spin" /> Loading your Notion tasks...</div>}
        {!loading && filtered.length === 0 && <div className="table-message">No tasks match these filters.</div>}
      </div>}
      {!loading && <div className="table-footer">Showing {filtered.length} of {tasks.length} tasks</div>}
      {loading && <div className="skeleton-row"><span /><span /><span /><span /></div>}
    </section>
  );
}

export default function DashboardPage() {
  const { isLoaded, user } = useUser();
  const hasAccess = Boolean(user);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [taskOptions, setTaskOptions] = useState<TaskOptions | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [taskToBreakDown, setTaskToBreakDown] = useState<Task | null>(null);

  const loadTasks = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const result = await response.json() as TasksResponse;
      if (!response.ok || !result.configured) throw new Error(result.error ?? "Could not load your Notion database.");
      setTasks(result.tasks);
      setTaskOptions(result.options ?? null);
      setState("ready");
      setLastUpdated(new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date()));
    } catch (loadError) {
      setTasks([]);
      setState("error");
      setError(loadError instanceof Error ? loadError.message : "Could not load your Notion database.");
    }
  }, []);

  useEffect(() => {
    if (isLoaded && hasAccess) void loadTasks();
  }, [hasAccess, isLoaded, loadTasks]);

  function handleTaskSaved(task: Task) {
    setTasks((current) => editingTask
      ? current.map((currentTask) => currentTask.id === task.id ? task : currentTask)
      : [task, ...current]);
    setCreateDialogOpen(false);
    setEditingTask(null);
    setLastUpdated(new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date()));
    setSuccessMessage(editingTask ? `“${task.title}” was updated.` : `“${task.title}” was added to your Notion planner.`);
  }

  function handleAssistantTaskSaved(task: Task) {
    setTasks((current) => current.some((item) => item.id === task.id)
      ? current.map((item) => item.id === task.id ? task : item)
      : [task, ...current]);
    setLastUpdated(new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date()));
  }

  const clearTaskToBreakDown = useCallback(() => setTaskToBreakDown(null), []);

  async function handleTaskDelete(task: Task) {
    if (!window.confirm(`Archive “${task.title}” from your Notion planner? This can be restored from Notion’s trash.`)) return;
    setDeletingTaskId(task.id);
    setActionError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not archive the planner item.");
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setLastUpdated(new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date()));
      setSuccessMessage(`“${task.title}” was archived from your planner.`);
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "Could not archive the planner item.");
    } finally {
      setDeletingTaskId("");
    }
  }

  const today = isoToday();
  const metrics = useMemo(() => {
    const completed = tasks.filter((task) => task.completed).length;
    const pending = tasks.length - completed;
    const overdue = tasks.filter((task) => isOverdue(task, today)).length;
    return { completed, pending, overdue, completion: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 };
  }, [tasks, today]);

  const statusDistribution = [
    { name: "Completed", value: metrics.completed },
    { name: "Pending", value: metrics.pending },
  ];
  const priorityData = countBy(tasks, (task) => task.priority).filter((item) => item.name !== "Unassigned");
  const typeData = countBy(tasks, (task) => task.type).filter((item) => item.name !== "Other");
  const timelineData = getTimeline(tasks);
  const areaData = countBy(tasks, (task) => task.area)
    .map((area) => {
      const areaTasks = tasks.filter((task) => (task.area.trim() || "Other") === area.name);
      const completed = areaTasks.filter((task) => task.completed).length;
      return { ...area, completed, percentage: areaTasks.length ? Math.round((completed / areaTasks.length) * 100) : 0 };
    }).filter((area) => area.name !== "Unassigned").slice(0, 5);
  const courseGroups = new Map<string, Task[]>();
  tasks.forEach((task) => {
    const code = task.courseCode?.trim();
    if (code) courseGroups.set(code, [...(courseGroups.get(code) ?? []), task]);
  });
  const courseData = Array.from(courseGroups, ([code, courseTasks]) => {
    const completed = courseTasks.filter((task) => task.completed).length;
    const remainingHours = courseTasks.filter((task) => !task.completed)
      .reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0);
    return {
      code,
      name: courseTasks.find((task) => task.course)?.course || code,
      completed,
      total: courseTasks.length,
      remainingHours,
      percentage: courseTasks.length ? Math.round((completed / courseTasks.length) * 100) : 0,
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const courseWorkloadHours = tasks.filter((task) => !task.completed)
    .reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0);
  const greeting = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  if (!isLoaded) {
    return <main className="auth-page"><LoaderCircle size={20} className="spin" /><span>Checking your access…</span></main>;
  }
  if (!hasAccess) {
    return (
      <main className="auth-page">
        <section className="access-denied">
          <h1>Sign in required</h1>
          <p>Sign in with the verified email address authorized for this planner.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell" id="overview">
      <div className={`sidebar-wrap${sidebarOpen ? " sidebar-open" : ""}`}><Sidebar onClose={() => setSidebarOpen(false)} /></div>
      {sidebarOpen && <button className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu round-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>Overview</strong></div>
          <div className="topbar-right">
            <span className="updated-label">{lastUpdated ? `Updated at ${lastUpdated}` : "Live from Notion"}</span>
            <button className={`refresh-button${state === "loading" ? " refreshing" : ""}`} onClick={() => void loadTasks()} disabled={state === "loading"} aria-label="Refresh tasks"><RefreshCw size={14} /> <span>Refresh</span></button>
            <span className={`connection-label ${state === "ready" ? "connected" : state === "error" ? "disconnected" : ""}`}><i />{state === "ready" ? "Connected" : state === "error" ? "Not connected" : "Connecting"}</span>
            <UserButton />
          </div>
        </header>

        <div className="page-wrap">
          <section className="welcome-row">
            <div><div className="date-line"><CalendarDays size={13} />{greeting}</div><h1>{new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening"}, Asladin <span aria-hidden="true">✳</span></h1><p>Your academic and life planner, at a glance.</p></div>
            <a className="open-notion-button" href="https://www.notion.so" target="_blank" rel="noreferrer">Open Notion <ExternalLink size={13} /></a>
          </section>

          {state === "error" && <div className="connection-banner"><span className="banner-icon"><AlertTriangle size={16} /></span><div><strong>We couldn’t load your Notion tasks</strong><p>{error}</p></div><button onClick={() => void loadTasks()}>Try again</button></div>}
          {state === "loading" && tasks.length === 0 && <div className="loading-banner"><LoaderCircle size={15} className="spin" /> Connecting securely to your Notion database...</div>}
          {successMessage && <div className="success-banner" role="status"><Check size={15} /><span>{successMessage}</span><button onClick={() => setSuccessMessage("")} aria-label="Dismiss">×</button></div>}
          {actionError && <div className="connection-banner" role="alert"><span className="banner-icon"><AlertTriangle size={16} /></span><div><strong>Could not update the planner</strong><p>{actionError}</p></div><button onClick={() => setActionError("")}>Dismiss</button></div>}

          <section className="metrics-grid" aria-label="Task overview">
            <MetricCard label="Total tasks" value={state === "loading" && tasks.length === 0 ? "—" : tasks.length} note="Across your planner" icon={ListChecks} tone="tone-green" />
            <MetricCard label="Completed" value={metrics.completed} note={`${metrics.completion}% completion`} icon={CheckCheck} tone="tone-sage" trend="up" />
            <MetricCard label="Pending" value={metrics.pending} note="Still on your list" icon={Clock3} tone="tone-violet" />
            <MetricCard label="Overdue" value={metrics.overdue} note={metrics.overdue ? "Needs your attention" : "You’re all caught up"} icon={Flame} tone={metrics.overdue ? "tone-red" : "tone-amber"} trend={metrics.overdue ? "down" : undefined} />
          </section>

          <div className="section-heading" id="progress"><div><h2>Your progress</h2><p>See where your time and attention are going</p></div><span className="live-label"><i /> All insights from your database</span></div>
          <section className="charts-grid">
            <article className="panel chart-panel"><div className="panel-heading"><div><h3>Task status</h3><p>Completed vs. pending</p></div><span className="chart-heading-icon tone-green"><CheckCheck size={15} /></span></div><div className="status-chart-row"><StatusChart data={statusDistribution} /><div className="status-legend"><div><i className="legend-completed" /><span>Completed</span><strong>{metrics.completed}</strong></div><div><i className="legend-pending" /><span>Pending</span><strong>{metrics.pending}</strong></div></div></div></article>
            <article className="panel chart-panel"><div className="panel-heading"><div><h3>Priority distribution</h3><p>Focus on what matters most</p></div><span className="chart-heading-icon tone-amber"><Flame size={15} /></span></div>{priorityData.length > 0 ? <PriorityChart data={priorityData} /> : <div className="chart-empty">Add priorities to your Notion tasks to see this chart.</div>}</article>
            <article className="panel chart-panel"><div className="panel-heading"><div><h3>Task type</h3><p>How your tasks are categorized</p></div><span className="chart-heading-icon tone-violet"><Target size={15} /></span></div><TypeChart data={typeData} /></article>
            <article className="panel chart-panel timeline-panel"><div className="panel-heading"><div><h3>Task timeline</h3><p>Tasks created over the last 6 months</p></div><span className="chart-heading-icon tone-blue"><CalendarDays size={15} /></span></div><TimelineChart data={timelineData} /></article>
          </section>

          <PlannerAssistant disabled={state !== "ready"} tasks={tasks} options={taskOptions}
            taskToBreakDown={taskToBreakDown} onBreakdownHandled={clearTaskToBreakDown}
            onTaskSaved={handleAssistantTaskSaved} />

          <div className="content-grid">
            <CalendarCard tasks={tasks} />
            <section className="panel areas-panel">
              <div className="panel-heading"><div><h2>Progress by area</h2><p>Completion across your focus areas</p></div><Target size={16} className="panel-title-icon" /></div>
              <div className="area-list">
                {areaData.map((area, index) => (
                  <div className="area-row" key={area.name}>
                    <div className="area-topline"><span className={`area-color area-color-${index}`} /><strong>{area.name}</strong><span className="area-task-count">{area.completed}/{area.value}</span><b>{area.percentage}%</b></div>
                    <div className="area-progress"><span className={`area-progress-${index}`} style={{ width: `${area.percentage}%` }} /></div>
                  </div>
                ))}
                {state === "ready" && areaData.length === 0 && <div className="chart-empty area-empty">Add an Area to your tasks to see progress here.</div>}
                {state === "loading" && areaData.length === 0 && <div className="area-placeholder"><span /><span /><span /></div>}
              </div>
              <div className="course-progress-section">
                <div className="course-progress-heading"><strong>Courses</strong><span>{courseWorkloadHours}h remaining</span></div>
                {courseData.map((course, index) => (
                  <div className="course-progress-row" key={course.code}>
                    <div className="course-progress-label"><span className={`course-progress-dot course-progress-dot-${index % 5}`} /><strong>{course.code}</strong><span>{course.name}</span><b>{course.remainingHours}h</b></div>
                    <div className="course-progress-bar"><span style={{ width: `${course.percentage}%` }} /></div>
                    <small>{course.completed}/{course.total} completed · {course.total - course.completed} pending</small>
                  </div>
                ))}
                {courseData.length === 0 && <p className="course-progress-empty">Add a Course Code to academic items to see course workload.</p>}
              </div>
              <div className="area-summary"><span><span className="summary-dot" />{areaData.length} active areas</span><span>{metrics.completion}% avg. completion</span></div>
              <div className="focus-tip"><Sparkles size={14} /><span><strong>Keep your momentum</strong> Small steps across every area still add up.</span></div>
            </section>
          </div>

          <TaskTable tasks={tasks} options={taskOptions} loading={state === "loading"} search={search} onSearch={setSearch}
            onCreate={() => { setEditingTask(null); setCreateDialogOpen(true); }}
            onEdit={(task) => { setCreateDialogOpen(false); setEditingTask(task); }}
            onBreakdown={(task) => {
              setTaskToBreakDown(task);
              void document.getElementById("planner-assistant")?.scrollIntoView({ behavior: "smooth" });
            }}
            onDelete={(task) => void handleTaskDelete(task)}
            createDisabled={state !== "ready" || !taskOptions} deleting={Boolean(deletingTaskId)} />

          <footer className="page-footer"><span>Made for a more focused day</span><span><i /> Connected securely to your Notion database <span className="footer-separator">·</span> {tasks.length} planner items</span></footer>
        </div>
      </main>
      {(createDialogOpen || editingTask) && taskOptions && <TaskDialog key={editingTask?.id ?? "new"} options={taskOptions} task={editingTask}
        onClose={() => { setCreateDialogOpen(false); setEditingTask(null); }} onSaved={handleTaskSaved} />}
    </div>
  );
}
