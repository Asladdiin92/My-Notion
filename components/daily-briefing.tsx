"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock3, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { apiErrorMessage, readApiResponse } from "@/lib/api-response";

type DailyBriefingData = {
  greeting: string;
  summary: {
    tasksToday: number;
    overdueTasks: number;
    upcomingItems: number;
    activeProjects: number;
    focusMinutesToday?: number;
  };
  recommendedAction: {
    entityId: string;
    title: string;
    reason: string;
    estimatedMinutes: number | null;
    score: number;
  } | null;
  warnings: string[];
  source: "ai" | "fallback";
  generatedAt: string;
};

type BriefingResponse = DailyBriefingData & { error?: string };

export function DailyBriefingPanel({ refreshKey }: { refreshKey: number }) {
  const [briefing, setBriefing] = useState<DailyBriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  const load = useCallback(async (regenerate = false) => {
    setError("");
    if (regenerate) setRegenerating(true);
    else setLoading(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const endpoint = regenerate ? "/api/briefing/regenerate" : "/api/briefing/daily";
      const response = await fetch(`${endpoint}?timezone=${encodeURIComponent(timeZone)}`, {
        method: regenerate ? "POST" : "GET",
        cache: "no-store",
        ...(regenerate ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
        signal: AbortSignal.timeout(65_000),
      });
      const result = await readApiResponse<BriefingResponse>(response);
      if (!response.ok) throw new Error(result.error ?? "Could not load your daily briefing.");
      if (!result.summary || !result.greeting || !result.generatedAt ||
          !["ai", "fallback"].includes(result.source) || !Array.isArray(result.warnings)) {
        throw new Error("The daily briefing service returned invalid data.");
      }
      setBriefing(result);
    } catch (requestError) {
      setError(apiErrorMessage(requestError, "Could not load your daily briefing."));
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey, retryKey]);

  const retry = useCallback(() => setRetryKey((current) => current + 1), []);
  const action = briefing?.recommendedAction;
  const generatedAt = briefing ? new Date(briefing.generatedAt) : null;

  return (
    <section className="panel daily-briefing-panel" aria-labelledby="daily-briefing-title">
      <div className="panel-heading daily-briefing-heading">
        <div>
          <span className="insight-eyebrow">YOUR DAY · STRUCTURED BRIEFING</span>
          <h2 id="daily-briefing-title">Daily briefing</h2>
          <p>{briefing?.greeting ?? "Your planner, summarized for today."}</p>
        </div>
        <span className="chart-heading-icon tone-green"><Sparkles size={15} /></span>
      </div>

      {loading && !briefing && (
        <div className="daily-briefing-loading" role="status">
          <LoaderCircle size={14} className="spin" /> Preparing your briefing…
        </div>
      )}
      {error && (
        <div className="daily-briefing-error" role="alert">
          <AlertTriangle size={14} /><span>{error}</span>
          <button type="button" onClick={retry}>Retry</button>
        </div>
      )}
      {briefing && (
        <>
          <div className="daily-briefing-counts" aria-label="Daily planner summary">
            <span><strong>{briefing.summary.tasksToday}</strong> due today</span>
            <span className={briefing.summary.overdueTasks ? "briefing-overdue" : ""}><strong>{briefing.summary.overdueTasks}</strong> overdue</span>
            <span><strong>{briefing.summary.upcomingItems}</strong> upcoming</span>
            <span><strong>{briefing.summary.activeProjects}</strong> active projects</span>
            {briefing.summary.focusMinutesToday !== undefined && (
              <span><strong>{briefing.summary.focusMinutesToday}</strong> focus min</span>
            )}
          </div>
          {action ? (
            <article className="daily-briefing-action">
              <div className="daily-briefing-action-heading">
                <span>RECOMMENDED NEXT ACTION</span>
                <span className={`briefing-source${briefing.source === "fallback" ? " is-fallback" : ""}`}>
                  {briefing.source === "ai" ? <Sparkles size={11} /> : <RefreshCw size={11} />}
                  {briefing.source === "ai" ? "AI" : "Deterministic fallback"}
                </span>
              </div>
              <strong>{action.title}</strong>
              <p>{action.reason}</p>
              <div className="daily-briefing-action-meta">
                <span>{action.estimatedMinutes === null ? "No estimate recorded" : `${action.estimatedMinutes} min estimated`}</span>
                <span>Priority score {action.score}/100</span>
              </div>
            </article>
          ) : (
            <p className="daily-briefing-empty">No unfinished planner task is available to recommend.</p>
          )}
          {briefing.warnings.length > 0 && (
            <ul className="daily-briefing-warnings">
              {briefing.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
          {generatedAt && Number.isFinite(generatedAt.getTime()) && (
            <p className="daily-briefing-generated"><Clock3 size={11} /> Updated {generatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
          )}
        </>
      )}
      <div className="daily-briefing-footer">
        {briefing?.source === "fallback" && !briefing.warnings.some((warning) => warning.includes("deterministic")) && (
          <span className="briefing-fallback-label"><RefreshCw size={11} /> Deterministic fallback</span>
        )}
        <button type="button" onClick={() => void load(true)} disabled={regenerating} className="daily-briefing-refresh">
          {regenerating ? <><LoaderCircle size={12} className="spin" /> Regenerating…</> : <><RefreshCw size={12} /> Regenerate</>}
        </button>
      </div>
    </section>
  );
}
