"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  BriefcaseBusiness,
  Clock3,
  ListChecks,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { apiErrorMessage, readApiResponse } from "@/lib/api-response";
import { calculateDashboardTaskMetrics } from "@/lib/dashboard-metrics";
import type { Task } from "@/lib/types";
import { PLANNER_TIME_ZONE } from "@/lib/planner-datetime";

type FocusTimeResponse = { focusMinutesToday: number; generatedAt: string; error?: string };

export function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  note: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-head">
        <span>{label}</span>
        <span className={`metric-icon ${tone}`}><Icon size={16} strokeWidth={1.9} /></span>
      </div>
      <div className="metric-value-row"><strong className="metric-value">{value}</strong></div>
      <div className="metric-note">{note}</div>
    </article>
  );
}

export function MetricsSkeleton() {
  return (
    <section className="metrics-grid metrics-skeleton" aria-label="Loading dashboard metrics" aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        <article className="metric-card metrics-skeleton-card" key={index} aria-hidden="true">
          <span /><span /><i />
        </article>
      ))}
      <span className="sr-only">Loading dashboard metrics…</span>
    </section>
  );
}

export function MetricsErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="metrics-error" role="alert">
      <AlertTriangle size={14} />
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry} aria-label="Retry loading focus time"><RefreshCw size={12} /> Retry</button>}
    </div>
  );
}

export function MetricsGrid({
  tasks,
  tasksReady,
  tasksError,
  refreshKey,
  timeZone,
}: {
  tasks: Task[];
  tasksReady: boolean;
  tasksError?: string;
  refreshKey: number;
  timeZone: string;
}) {
  const [focusMinutes, setFocusMinutes] = useState<number | null>(null);
  const [focusLoading, setFocusLoading] = useState(true);
  const [focusError, setFocusError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [deviceTimeZone, setDeviceTimeZone] = useState(timeZone);

  const taskMetrics = useMemo(
    () => calculateDashboardTaskMetrics(tasks, deviceTimeZone),
    [tasks, deviceTimeZone],
  );

  const retry = useCallback(() => setRetryKey((current) => current + 1), []);

  useEffect(() => {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      new Intl.DateTimeFormat("en", { timeZone: browserTimeZone }).format();
      setDeviceTimeZone(browserTimeZone);
    } catch {
      setDeviceTimeZone(PLANNER_TIME_ZONE);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setFocusLoading(true);
    setFocusError("");
    void (async () => {
      try {
        const response = await fetch(`/api/dashboard/focus-time?timezone=${encodeURIComponent(deviceTimeZone)}`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const result = await readApiResponse<FocusTimeResponse>(response);
        if (!response.ok) throw new Error(result.error ?? "Could not load today’s focus time.");
        if (!Number.isSafeInteger(result.focusMinutesToday) || result.focusMinutesToday < 0 ||
            typeof result.generatedAt !== "string" || !Number.isFinite(new Date(result.generatedAt).getTime())) {
          throw new Error("The focus-time service returned invalid metrics.");
        }
        setFocusMinutes(result.focusMinutesToday);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setFocusMinutes(null);
        setFocusError(apiErrorMessage(requestError, "Focus time is temporarily unavailable."));
      } finally {
        if (!controller.signal.aborted) setFocusLoading(false);
      }
    })();
    return () => controller.abort();
  }, [refreshKey, retryKey, deviceTimeZone]);

  if (!tasksReady && !tasksError) return <MetricsSkeleton />;

  const partialData = Boolean(tasksError || focusError);
  const focusDisplay = focusLoading ? "…" : focusMinutes === null
    ? "—"
    : focusMinutes >= 60
      ? `${Math.floor(focusMinutes / 60)}h ${focusMinutes % 60}m`
      : `${focusMinutes}m`;

  return (
    <>
      <section className="metrics-grid" aria-label="Today’s dashboard metrics">
        <MetricCard
          label="Due Today"
          value={tasksError ? "—" : taskMetrics.tasksDueToday}
          note={tasksError ? "Notion data unavailable" : `In ${deviceTimeZone}`}
          icon={ListChecks}
          tone="tone-green"
        />
        <MetricCard
          label="Projects"
          value={tasksError ? "—" : taskMetrics.activeProjects}
          note={tasksError ? "Notion data unavailable" : "Areas with unfinished work"}
          icon={BriefcaseBusiness}
          tone="tone-violet"
        />
        <MetricCard
          label="Notes"
          value={tasksError ? "—" : taskMetrics.notesCount}
          note={tasksError ? "Notion data unavailable" : "Planner items with notes"}
          icon={BookOpen}
          tone="tone-amber"
        />
        <MetricCard
          label="Focus"
          value={focusDisplay}
          note={focusError ? "Focus data unavailable" : focusMinutes === 0 ? "No recorded focus yet" : `In ${deviceTimeZone}`}
          icon={Clock3}
          tone="tone-blue"
        />
      </section>
      {partialData && (
        <MetricsErrorState
          message={tasksError ? "Some metrics are unavailable because Notion could not be loaded." : focusError}
          onRetry={focusError ? retry : undefined}
        />
      )}
      {!partialData && !focusLoading && focusMinutes === 0 && (
        <p className="metrics-empty-note"><Clock3 size={12} /> No focus sessions have been recorded today.</p>
      )}
    </>
  );
}
