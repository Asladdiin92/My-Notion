"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Circle,
  Clock3,
  ExternalLink,
  LoaderCircle,
  type LucideIcon,
  Mail,
  Sparkles,
  Target,
} from "lucide-react";
import { formatPlannerDate, plannerDateKey, todayInPlannerTimeZone, PLANNER_TIME_ZONE } from "@/lib/planner-datetime";
import { apiErrorMessage, readApiResponse } from "@/lib/api-response";
import type { FocusWindow, NextActionCandidate, NextActionSelection } from "@/lib/next-action";
import type { Task } from "@/lib/types";

type Recommendation = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
  mode: "ask" | "secretary";
  disabled?: boolean;
};

type NextActionResponse = NextActionSelection & {
  explanation?: { reason: string; firstStep: string };
  calendarConnected: boolean;
  currentLocalTime?: string;
  error?: string;
};

function safeTaskUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function focusWindowLabel(window: FocusWindow): string {
  const date = new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: PLANNER_TIME_ZONE,
  }).format(new Date(`${window.date}T12:00:00Z`));
  return `${date}, ${window.startTime}–${window.endTime}`;
}

export function NextBestActionPanel({ disabled }: { disabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<NextActionResponse | null>(null);

  async function requestRecommendation() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/assistant/next-action", {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await readApiResponse<NextActionResponse>(response);
      if (!response.ok) throw new Error(payload.error ?? "Could not get a next-action recommendation.");
      if (payload.candidate && (!payload.focusWindow || !payload.explanation?.reason || !payload.explanation.firstStep)) {
        throw new Error("The server returned an incomplete recommendation. Please try again.");
      }
      setResult(payload);
    } catch (requestError) {
      setError(apiErrorMessage(requestError, "Could not get a next-action recommendation."));
    } finally {
      setLoading(false);
    }
  }

  const candidate: NextActionCandidate | null = result?.candidate ?? null;
  const dueDate = candidate?.dueDate;
  const validDueDate = Boolean(dueDate && !Number.isNaN(new Date(dueDate).getTime()));
  const safeUrl = candidate ? safeTaskUrl(candidate.url) : undefined;

  return (
    <section className="panel next-action-panel" aria-labelledby="next-action-title">
      <div className="panel-heading next-action-heading">
        <div>
          <span className="insight-eyebrow">ON-DEMAND · APPROVAL ONLY</span>
          <h2 id="next-action-title">Next best action</h2>
          <p>Ranks incomplete planner items against the next available 08:30–18:00 Addis Ababa focus window.</p>
        </div>
        <span className="chart-heading-icon tone-green"><Target size={15} /></span>
      </div>
      {!result && !error && (
        <div className="next-action-intro">
          <p>Nothing is sent to AI until you request a recommendation. Nothing is changed in Notion.</p>
          <button type="button" className="next-action-run" onClick={() => void requestRecommendation()} disabled={disabled || loading}>
            {loading ? <><LoaderCircle size={13} className="spin" /> Checking your planner…</> : <><Sparkles size={13} /> Recommend my next action</>}
          </button>
        </div>
      )}
      {error && <div className="next-action-error" role="alert"><p>{error}</p><button type="button" onClick={() => void requestRecommendation()} disabled={disabled || loading}>Try again</button></div>}
      {result && !candidate && <div className="next-action-empty" role="status"><p>{result.message ?? "No incomplete planner item is available to recommend."}</p>
        <button type="button" className="next-action-run" onClick={() => void requestRecommendation()} disabled={disabled || loading}>Check again</button></div>}
      {result && candidate && result.focusWindow && result.explanation && (
        <div className="next-action-result" aria-live="polite">
          {result.currentLocalTime && <p className="next-action-checked">Checked {result.currentLocalTime}</p>}
          <div className="next-action-task">
            <div><span className="next-action-overline">RECOMMENDED TASK</span><strong>{candidate.title}</strong></div>
            {safeUrl && <a href={safeUrl} target="_blank" rel="noreferrer" aria-label={`Open ${candidate.title} in Notion`}><ExternalLink size={13} /></a>}
          </div>
          <div className="next-action-facts">
            <span className={`next-action-deadline deadline-${candidate.dueLabel.toLowerCase().replaceAll(" ", "-")}`}>{candidate.dueLabel}{validDueDate ? ` · ${formatPlannerDate(dueDate!)}` : ""}</span>
            <span>{candidate.priority} priority</span>
            <span>{candidate.estimatedMinutes === null ? "No duration estimate recorded" : `Notion estimate · ${candidate.estimatedMinutes} min`}</span>
          </div>
          <p className="next-action-window"><Clock3 size={12} /> Focus window: {focusWindowLabel(result.focusWindow)} ({result.focusWindow.availableMinutes} min available)</p>
          {!result.calendarConnected && <p className="next-action-calendar-note">Google Calendar isn&apos;t connected, so meeting conflicts could not be checked.</p>}
          {result.calendarConnected && <p className="next-action-calendar-note">{result.focusWindow.nextEventStart
            ? `Free time ends at ${result.focusWindow.nextEventStart} for your next calendar event.`
            : "Calendar checked; no meeting conflicts fall within this focus window."}</p>}
          {result.explanation.reason && <div className="next-action-reason"><strong>Why this task</strong><p>{result.explanation.reason}</p></div>}
          <div className="next-action-first-step"><strong>First step</strong><p>{result.explanation.firstStep}</p></div>
          {candidate.nextAction && <p className="next-action-recorded">Recorded next action: {candidate.nextAction}</p>}
          <button type="button" className="next-action-rerun" onClick={() => void requestRecommendation()} disabled={disabled || loading}>
            {loading ? <LoaderCircle size={12} className="spin" /> : <Sparkles size={12} />} Recheck priorities
          </button>
        </div>
      )}
    </section>
  );
}

function activityDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PLANNER_TIME_ZONE,
  }).format(date);
}

export function RecentActivityPanel({ tasks, loading }: { tasks: Task[]; loading: boolean }) {
  const activities = tasks
    .map((task) => {
      const created = new Date(task.createdAt).getTime();
      const updated = new Date(task.updatedAt || task.createdAt).getTime();
      const hasUpdate = Number.isFinite(updated) && Number.isFinite(created) && updated > created + 60_000;
      return {
        task,
        timestamp: hasUpdate ? task.updatedAt || task.createdAt : task.createdAt,
        action: hasUpdate ? "Planner item updated" : "Added to your planner",
      };
    })
    .filter(({ timestamp }) => Number.isFinite(new Date(timestamp).getTime()))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);
  const today = todayInPlannerTimeZone();

  return (
    <section className="panel activity-panel" aria-labelledby="recent-activity-title">
      <div className="insight-heading">
        <div>
          <span className="insight-eyebrow">YOUR WORKSPACE</span>
          <h2 id="recent-activity-title">Recent activity</h2>
          <p>Latest additions and edits recorded in your Notion planner.</p>
        </div>
        <span className="insight-heading-icon activity-heading-icon"><Clock3 size={17} /></span>
      </div>
      {activities.length > 0 ? (
        <ol className="activity-list">
          {activities.map(({ task, timestamp, action }) => {
            const dueDate = task.dateEnd || task.dueDate;
            const status = task.completed
              ? { label: "Completed", tone: "activity-status-complete" }
              : dueDate && plannerDateKey(dueDate) < today
                ? { label: "Overdue", tone: "activity-status-overdue" }
                : { label: task.status || "In progress", tone: "activity-status-open" };
            return (
              <li className="activity-item" key={task.id}>
                <span className={`activity-check${task.completed ? " is-complete" : ""}`}>
                  {task.completed ? <Check size={14} strokeWidth={2.5} /> : <Circle size={13} strokeWidth={2} />}
                </span>
                <div className="activity-copy">
                  <strong>{task.title}</strong>
                  <span>{action}{task.area && task.area !== "Unassigned" ? ` · ${task.area}` : ""}</span>
                </div>
                <time dateTime={timestamp}>{activityDate(timestamp)}</time>
                <span className={`activity-status ${status.tone}`}>{status.label}</span>
              </li>
            );
          })}
        </ol>
      ) : loading ? (
        <div className="activity-empty">
          <LoaderCircle size={15} className="spin" />
          <p>Loading recent planner activity…</p>
        </div>
      ) : (
        <div className="activity-empty">
          <span className="activity-check"><Circle size={13} /></span>
          <p>Planner activity will appear here when items are added or updated.</p>
        </div>
      )}
      <p className="activity-footnote">This feed reflects planner timestamps; it isn&apos;t a complete record of activity outside Notion.</p>
    </section>
  );
}

export function AIRecommendationsPanel({
  disabled,
  googleConnected,
  onNotify,
}: {
  disabled: boolean;
  googleConnected: boolean;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [runningId, setRunningId] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const recommendations: Recommendation[] = [
    {
      id: "priorities",
      title: "Choose my next priority",
      description: "Rank pending tasks by urgency, deadline, and effort.",
      prompt: "Review my pending tasks and recommend the top three priorities for today. For each, give one practical next action and explain briefly why it belongs in that order. Do not invent deadlines or progress.",
      icon: Target,
      mode: "ask",
    },
    {
      id: "inbox",
      title: "Triage my unread inbox",
      description: "Find urgent asks and summarize what needs a reply.",
      prompt: "Review my unread Gmail messages and identify genuinely urgent requests, deadlines, and messages that need a reply. Summarize each briefly with sender and subject. Do not draft or send replies.",
      icon: Mail,
      mode: "secretary",
      disabled: !googleConnected,
    },
    {
      id: "calendar",
      title: "Prepare for my next meeting",
      description: "Review upcoming events and highlight useful preparation.",
      prompt: "Review my upcoming Google Calendar events and connected planner tasks. Tell me what meeting is next and suggest preparation based only on available event details and relevant pending tasks. Do not create or change calendar events.",
      icon: CalendarClock,
      mode: "secretary",
      disabled: !googleConnected,
    },
  ];

  async function runRecommendation(recommendation: Recommendation) {
    setRunningId(recommendation.id);
    setErrors((current) => ({ ...current, [recommendation.id]: "" }));
    setResults((current) => ({ ...current, [recommendation.id]: "" }));
    onNotify(`Running: ${recommendation.title}…`, "info");
    try {
      const secretary = recommendation.mode === "secretary";
      const response = await fetch(secretary ? "/api/google/assistant" : "/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(secretary
          ? { question: recommendation.prompt }
          : { mode: "ask", question: recommendation.prompt }),
      });
      const result = await readApiResponse<{ answer?: string; error?: string }>(response);
      if (!response.ok || !result.answer) {
        throw new Error(result.error ?? "The assistant could not complete this recommendation.");
      }
      setResults((current) => ({ ...current, [recommendation.id]: result.answer! }));
      onNotify(`${recommendation.title} is ready.`);
    } catch (error) {
      const message = apiErrorMessage(error, "The assistant could not complete this recommendation.");
      setErrors((current) => ({
        ...current,
        [recommendation.id]: message,
      }));
      onNotify(message, "error");
    } finally {
      setRunningId("");
    }
  }

  return (
    <section className="panel recommendations-panel" aria-labelledby="recommendations-title">
      <div className="insight-heading">
        <div>
          <span className="insight-eyebrow">AI-POWERED NEXT STEPS</span>
          <h2 id="recommendations-title">Recommendations</h2>
          <p>Run a focused review using your planner or connected Google data.</p>
        </div>
        <span className="insight-heading-icon recommendations-heading-icon"><Sparkles size={17} /></span>
      </div>
      <div className="recommendation-list">
        {recommendations.map((recommendation) => {
          const Icon = recommendation.icon;
          const unavailable = disabled || Boolean(recommendation.disabled);
          const busy = runningId === recommendation.id;
          return (
            <article className={`recommendation-card${results[recommendation.id] ? " has-result" : ""}`} key={recommendation.id}>
              <span className={`recommendation-icon recommendation-icon-${recommendation.id}`}><Icon size={16} /></span>
              <div className="recommendation-copy">
                <strong>{recommendation.title}</strong>
                <p>{recommendation.disabled && !googleConnected ? "Connect Google to enable this review." : recommendation.description}</p>
              </div>
              <button type="button" className="recommendation-run" onClick={() => void runRecommendation(recommendation)} disabled={unavailable || Boolean(runningId)}>
                {busy ? <><LoaderCircle size={13} className="spin" /> Working</> : results[recommendation.id] ? <><Check size={13} /> Run again</> : <>Run <ArrowUpRight size={13} /></>}
              </button>
              {errors[recommendation.id] && <p className="recommendation-feedback recommendation-error" role="alert">{errors[recommendation.id]}</p>}
              {results[recommendation.id] && <div className="recommendation-feedback recommendation-result" role="status" aria-live="polite">{results[recommendation.id]}</div>}
            </article>
          );
        })}
      </div>
      <p className="recommendations-footnote">Each card runs only when selected. Google data is sent to the AI provider only for the selected Google review; no external actions are executed.</p>
    </section>
  );
}
