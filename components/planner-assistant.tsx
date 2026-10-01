"use client";

import { LoaderCircle, Send, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";

type AssistantResponse = { answer?: string; error?: string };

export function PlannerAssistant({ disabled }: { disabled: boolean }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask(mode: "suggest" | "ask", prompt = question) {
    setLoading(true);
    setError("");
    setAnswer("");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, question: prompt }),
      });
      const result = await response.json() as AssistantResponse;
      if (!response.ok || !result.answer) {
        throw new Error(result.error ?? "The planner assistant could not respond.");
      }
      setAnswer(result.answer);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The planner assistant could not respond.");
    } finally {
      setLoading(false);
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask("ask");
  }

  return (
    <section className="panel assistant-panel" id="planner-assistant" aria-labelledby="assistant-title">
      <div className="panel-heading">
        <div>
          <h2 id="assistant-title">Planner assistant</h2>
          <p>Get next-step ideas or ask about your Notion tasks.</p>
        </div>
        <span className="chart-heading-icon tone-violet"><Sparkles size={15} /></span>
      </div>
      <div className="assistant-controls">
        <button className="assistant-suggest" type="button" onClick={() => void ask("suggest")} disabled={disabled || loading}>
          {loading ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
          Suggest next actions
        </button>
        <form className="assistant-question" onSubmit={submitQuestion}>
          <label className="sr-only" htmlFor="assistant-question">Ask about your planner</label>
          <input id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)}
            maxLength={1000} placeholder="Ask about your tasks..." required disabled={disabled || loading} />
          <button type="submit" aria-label="Send question" disabled={disabled || loading || !question.trim()}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}
          </button>
        </form>
      </div>
      {disabled && <p className="assistant-hint">Connect to Notion and load your tasks to use the assistant.</p>}
      {(answer || error) && (
        <div className={`assistant-response${error ? " assistant-error" : ""}`} role={error ? "alert" : "status"} aria-live="polite">
          {error || answer}
        </div>
      )}
      <p className="assistant-privacy">Task details are sent to Google Gemini to generate each response.</p>
    </section>
  );
}
