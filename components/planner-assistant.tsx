"use client";

import { Check, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PlannerPlan, PlannerChange } from "@/lib/gemini";
import type { Task } from "@/lib/types";

type AssistantResponse = { answer?: string; plan?: PlannerPlan; error?: string };
type TaskMutationResponse = { ok: boolean; task?: Task; error?: string };
type ChangeField = keyof PlannerChange["fields"];

const fieldLabels: Record<ChangeField, string> = {
  title: "Title",
  type: "Type",
  status: "Status",
  priority: "Priority",
  area: "Area",
  course: "Course",
  dueDate: "Due date",
  nextAction: "Next action",
};

export function PlannerAssistant({
  disabled,
  tasks,
  onTaskSaved,
}: {
  disabled: boolean;
  tasks: Task[];
  onTaskSaved: (task: Task) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pendingChange, setPendingChange] = useState<PlannerChange | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(mode: "suggest" | "plan", prompt = question) {
    setLoading(true);
    setError("");
    setAnswer("");
    setPendingChange(null);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, question: prompt }),
      });
      const result = await response.json() as AssistantResponse;
      if (!response.ok) throw new Error(result.error ?? "The planner assistant could not respond.");
      if (mode === "plan") {
        if (!result.plan) throw new Error(result.error ?? "The planner assistant returned no proposal.");
        if (result.plan.action === "answer") setAnswer(result.plan.answer);
        else setPendingChange(result.plan);
      } else {
        if (!result.answer) throw new Error(result.error ?? "The planner assistant returned no answer.");
        setAnswer(result.answer);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The planner assistant could not respond.");
    } finally {
      setLoading(false);
    }
  }

  function submitInstruction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask("plan");
  }

  async function confirmChange() {
    if (!pendingChange || loading) return;
    const task = pendingChange.action === "update"
      ? tasks.find((item) => item.id === pendingChange.taskId)
      : undefined;
    if (pendingChange.action === "update" && !task) {
      setError("That task is no longer in the current planner list. Refresh and try again.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const fields = pendingChange.fields;
      const body = pendingChange.action === "create"
        ? fields
        : {
            title: fields.title ?? task!.title,
            type: fields.type ?? task!.type,
            status: fields.status ?? task!.status,
            priority: fields.priority ?? task!.priority,
            area: fields.area ?? task!.area,
            course: fields.course ?? task!.course,
            dueDate: fields.dueDate ?? task!.dueDate ?? "",
            nextAction: fields.nextAction ?? task!.nextAction,
          };
      const response = await fetch(
        pendingChange.action === "create" ? "/api/tasks" : `/api/tasks/${encodeURIComponent(task!.id)}`,
        {
          method: pendingChange.action === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json() as TaskMutationResponse;
      if (!response.ok || !result.ok || !result.task) {
        throw new Error(result.error ?? "Could not save the planner change.");
      }
      onTaskSaved(result.task);
      setPendingChange(null);
      setQuestion("");
      setAnswer(pendingChange.action === "create"
        ? `Created “${result.task.title}” in your Notion planner.`
        : `Updated “${result.task.title}” in your Notion planner.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the planner change.");
    } finally {
      setLoading(false);
    }
  }

  const pendingTask = pendingChange?.action === "update"
    ? tasks.find((task) => task.id === pendingChange.taskId)
    : undefined;

  return (
    <section className="panel assistant-panel" id="planner-assistant" aria-labelledby="assistant-title">
      <div className="panel-heading">
        <div>
          <h2 id="assistant-title">Planner assistant</h2>
          <p>Ask questions, get next-step ideas, or give an instruction to update your planner.</p>
        </div>
        <span className="chart-heading-icon tone-violet"><Sparkles size={15} /></span>
      </div>
      <div className="assistant-controls">
        <button className="assistant-suggest" type="button" onClick={() => void ask("suggest")} disabled={disabled || loading || Boolean(pendingChange)}>
          {loading ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
          Suggest next actions
        </button>
        <form className="assistant-question" onSubmit={submitInstruction}>
          <label className="sr-only" htmlFor="assistant-question">Ask a question or give a planner instruction</label>
          <input id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)}
            maxLength={1000} placeholder="Add a task, change a deadline, or ask a question..." required disabled={disabled || loading || Boolean(pendingChange)} />
          <button type="submit" aria-label="Plan instruction" disabled={disabled || loading || Boolean(pendingChange) || !question.trim()}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}
          </button>
        </form>
      </div>
      {disabled && <p className="assistant-hint">Connect to Notion and load your tasks to use the assistant.</p>}
      {answer && <div className="assistant-response" role="status" aria-live="polite">{answer}</div>}
      {pendingChange && (
        <div className="assistant-proposal" aria-live="polite">
          <div className="assistant-proposal-heading">
            <strong>Review this {pendingChange.action === "create" ? "new task" : "task update"}</strong>
            {pendingTask && <span>For: {pendingTask.title}</span>}
          </div>
          <p>{pendingChange.summary}</p>
          <dl className="assistant-change-list">
            {Object.entries(pendingChange.fields).map(([field, value]) => {
              const key = field as ChangeField;
              const previousValue = pendingTask && key !== "dueDate" ? pendingTask[key] : pendingTask?.dueDate;
              const displayedValue = value === "" ? "Clear this value" : key === "dueDate" ? value : value;
              return (
                <div key={field}>
                  <dt>{fieldLabels[key] ?? field}</dt>
                  <dd>
                    {pendingTask && previousValue !== value && <><span className="assistant-old-value">{previousValue || "Empty"}</span><span aria-hidden="true"> → </span></>}
                    {displayedValue}
                  </dd>
                </div>
              );
            })}
          </dl>
          <div className="assistant-proposal-actions">
            <button className="assistant-cancel" type="button" onClick={() => setPendingChange(null)} disabled={loading}>
              <X size={13} /> Cancel
            </button>
            <button className="assistant-confirm" type="button" onClick={() => void confirmChange()} disabled={loading || (pendingChange.action === "update" && !pendingTask)}>
              {loading ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}
              Confirm and {pendingChange.action === "create" ? "create" : "save"}
            </button>
          </div>
        </div>
      )}
      {error && <div className="assistant-response assistant-error" role="alert">{error}</div>}
      <p className="assistant-privacy">Task details are sent to Google Gemini to generate each response. Planner changes are only saved after you confirm.</p>
    </section>
  );
}
