"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Circle,
  Clock3,
  LoaderCircle,
  type LucideIcon,
  Mail,
  Sparkles,
  Target,
} from "lucide-react";
import { plannerDateKey, todayInPlannerTimeZone, PLANNER_TIME_ZONE } from "@/lib/planner-datetime";
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

export function RecentActivityPanel({ tasks }: { tasks: Task[] }) {
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
}: {
  disabled: boolean;
  googleConnected: boolean;
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
    try {
      const secretary = recommendation.mode === "secretary";
      const response = await fetch(secretary ? "/api/google/assistant" : "/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(secretary
          ? { question: recommendation.prompt }
          : { mode: "ask", question: recommendation.prompt }),
      });
      const result = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !result.answer) {
        throw new Error(result.error ?? "The assistant could not complete this recommendation.");
      }
      setResults((current) => ({ ...current, [recommendation.id]: result.answer! }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [recommendation.id]: error instanceof Error ? error.message : "The assistant could not complete this recommendation.",
      }));
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
