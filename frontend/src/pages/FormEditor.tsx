/** Builder: edit a conversation's title, description, and question list. */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  addQuestion,
  deleteQuestion,
  getForm,
  publicLink,
  reorderQuestions,
  suggestQuestions,
  updateForm,
  updateQuestion,
} from "../lib/api";
import type { Form, Question, QuestionType, SuggestedQuestion } from "../lib/types";

const TYPE_LABELS: Record<QuestionType, string> = {
  text: "Free text",
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
  rating: "Rating (1–5)",
  number: "Number",
  email: "Email",
  distribution: "Distribution (allocate 100)",
};

/** Types that carry an options list (one per line, at least two). */
const OPTION_TYPES: QuestionType[] = ["single_choice", "multi_choice", "distribution"];

/** Fixed order the AI suggestions are grouped into, by question type. */
const TYPE_ORDER: QuestionType[] = [
  "text",
  "single_choice",
  "multi_choice",
  "rating",
  "number",
  "email",
  "distribution",
];

/** A single form tops out here — kept in sync with the backend cap. */
const MAX_QUESTIONS = 30;

export default function FormEditor() {
  const { id = "" } = useParams();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    getForm(id).then(setForm).catch(() => setError("Conversation not found"));
  }, [id]);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!form) return <p className="text-dim">Loading…</p>;

  /** Persist a header field and mirror it in local state. */
  async function saveMeta(changes: Partial<Pick<Form, "title" | "description" | "is_open">>) {
    const updated = await updateForm(id, changes);
    setForm((f) => (f ? { ...f, ...updated, questions: f.questions } : f));
  }

  /** Append however many questions the add flow just created. */
  function handleAdded(created: Question[]) {
    setForm((f) => (f ? { ...f, questions: [...f.questions, ...created] } : f));
  }

  async function handleMove(index: number, direction: -1 | 1) {
    if (!form) return;
    const target = index + direction;
    if (target < 0 || target >= form.questions.length) return;
    const next = [...form.questions];
    [next[index], next[target]] = [next[target], next[index]];
    setForm({ ...form, questions: next });
    await reorderQuestions(id, next.map((q) => q.id));
  }

  async function handleDelete(question: Question) {
    if (!window.confirm("Delete this question?")) return;
    await deleteQuestion(question.id);
    setForm((f) =>
      f ? { ...f, questions: f.questions.filter((q) => q.id !== question.id) } : f,
    );
  }

  function handleSaved(saved: Question) {
    setForm((f) =>
      f
        ? { ...f, questions: f.questions.map((q) => (q.id === saved.id ? saved : q)) }
        : f,
    );
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(publicLink(form!.slug));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="text-sm text-dim hover:text-fog">
          ← All conversations
        </Link>
        <div className="flex items-center gap-2">
          <button className="btn-ghost text-xs" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy public link"}
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={() => saveMeta({ is_open: !form.is_open })}
          >
            {form.is_open ? "Close to answers" : "Reopen"}
          </button>
          <Link className="btn-primary text-xs" to={`/forms/${id}/insights`}>
            View insights
          </Link>
        </div>
      </div>

      {/* Title + description — saved when the field loses focus. */}
      <div className="card mb-6 space-y-4 p-6">
        <div>
          <label className="label">Title</label>
          <input
            className="input text-lg"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            onBlur={(e) => e.target.value.trim() && saveMeta({ title: e.target.value.trim() })}
          />
        </div>
        <div>
          <label className="label">Description (shown to respondents)</label>
          <textarea
            className="input resize-none"
            rows={2}
            placeholder="A sentence or two about what you're asking and why."
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            onBlur={(e) => saveMeta({ description: e.target.value })}
          />
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-dim">
          Questions
          <span className="ml-2 normal-case tracking-normal text-dim/70">
            {form.questions.length}/{MAX_QUESTIONS}
          </span>
        </h2>
        <button
          className="btn-primary text-xs"
          onClick={() => setAdding(true)}
          disabled={form.questions.length >= MAX_QUESTIONS}
        >
          + Add questions
        </button>
      </div>

      {form.questions.length === 0 ? (
        <div className="card p-10 text-center text-sm text-dim">
          No questions yet — add your first one above.
        </div>
      ) : (
        <div className="space-y-3">
          {form.questions.map((question, index) => (
            <QuestionEditor
              key={question.id}
              question={question}
              index={index}
              total={form.questions.length}
              onMove={handleMove}
              onDelete={handleDelete}
              onSaved={handleSaved}
            />
          ))}
        </div>
      )}

      {adding && (
        <AddQuestionsModal
          formId={id}
          remaining={MAX_QUESTIONS - form.questions.length}
          onAdded={handleAdded}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/** The add-questions flow: pick a count, then write your own blanks or ask the
 *  AI for a batch you cherry-pick from (grouped by question type). */
function AddQuestionsModal({
  formId,
  remaining,
  onAdded,
  onClose,
}: {
  formId: string;
  remaining: number;
  onAdded: (created: Question[]) => void;
  onClose: () => void;
}) {
  type Step = "count" | "method" | "topic" | "suggestions";
  const cap = Math.min(MAX_QUESTIONS, remaining);
  const [step, setStep] = useState<Step>("count");
  const [count, setCount] = useState(Math.min(5, cap));
  const [topic, setTopic] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestedQuestion[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false); // AI generating
  const [busy, setBusy] = useState(false); // creating questions
  const [error, setError] = useState("");

  // Once this many are picked, the remaining slots are full.
  const atCap = selected.size >= remaining;

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else if (next.size < remaining) next.add(index);
      return next;
    });
  }

  function setGroup(indices: number[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of indices) {
        if (on) {
          if (next.size >= remaining) break;
          next.add(i);
        } else {
          next.delete(i);
        }
      }
      return next;
    });
  }

  // Bucket the suggestion indices by question type, in a stable order.
  const groups = TYPE_ORDER.map((type) => ({
    type,
    indices: suggestions.reduce<number[]>((acc, s, i) => {
      if (s.type === type) acc.push(i);
      return acc;
    }, []),
  })).filter((group) => group.indices.length > 0);

  /** Create each draft through the normal question-create path, options intact. */
  async function createFrom(drafts: SuggestedQuestion[]) {
    setBusy(true);
    setError("");
    try {
      const created: Question[] = [];
      for (const draft of drafts) {
        created.push(
          await addQuestion(formId, {
            text: draft.text,
            type: draft.type,
            options: draft.options,
            required: draft.required,
          }),
        );
      }
      onAdded(created);
      onClose();
    } catch {
      setError("Couldn't add the questions. Please try again.");
      setBusy(false);
    }
  }

  function handleWriteOwn() {
    // Seed `count` blank questions the creator then fills in inline.
    const blanks: SuggestedQuestion[] = Array.from({ length: count }, () => ({
      text: "Untitled question",
      type: "text",
      options: [],
      required: true,
    }));
    void createFrom(blanks);
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await suggestQuestions(formId, topic.trim(), count);
      if (result.suggestions.length === 0) {
        setError("The AI didn't return anything usable — try a different topic.");
      } else {
        setSuggestions(result.suggestions);
        setSelected(new Set());
        setStep("suggestions");
      }
    } catch {
      setError("Couldn't generate suggestions right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleAddSelected() {
    const drafts = [...selected].sort((a, b) => a - b).map((i) => suggestions[i]);
    if (drafts.length > 0) void createFrom(drafts);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[85vh] w-full max-w-2xl flex-col p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium text-fog">Add questions</h3>
          <button
            className="btn-ghost px-2 py-1 text-xs"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        {/* Step 1 — how many */}
        {step === "count" && (
          <div className="space-y-4">
            <div>
              <label className="label">How many questions?</label>
              <input
                className="input w-32"
                type="number"
                min={1}
                max={cap}
                value={count}
                onChange={(e) =>
                  setCount(Math.max(1, Math.min(cap, Number(e.target.value) || 1)))
                }
              />
              <p className="mt-1.5 text-xs text-dim">
                {remaining} of {MAX_QUESTIONS} slots left on this conversation.
              </p>
            </div>
            <div className="flex justify-end">
              <button className="btn-primary text-sm" onClick={() => setStep("method")}>
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — write your own or ask AI */}
        {step === "method" && (
          <div className="space-y-4">
            <p className="text-sm text-dim">
              How do you want to create {count} question{count === 1 ? "" : "s"}?
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className="card p-5 text-left transition-colors hover:border-iris/60 disabled:opacity-50"
                onClick={handleWriteOwn}
                disabled={busy}
              >
                <div className="font-medium text-fog">Write my own</div>
                <div className="mt-1 text-xs text-dim">
                  Start with blank questions and fill them in yourself.
                </div>
              </button>
              <button
                className="card p-5 text-left transition-colors hover:border-glow/60 disabled:opacity-50"
                onClick={() => setStep("topic")}
                disabled={busy}
              >
                <div className="font-medium text-fog">Ask AI ✨</div>
                <div className="mt-1 text-xs text-dim">
                  Describe a topic and pick from suggested questions.
                </div>
              </button>
            </div>
            <div>
              <button className="btn-ghost text-sm" onClick={() => setStep("count")}>
                Back
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — topic */}
        {step === "topic" && (
          <div className="space-y-4">
            <div>
              <label className="label">Topic</label>
              <input
                className="input"
                placeholder="What topic should the questions cover?"
                value={topic}
                autoFocus
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleGenerate()}
                disabled={loading}
              />
              <p className="mt-1.5 text-xs text-dim">
                We'll draft up to {count} question{count === 1 ? "" : "s"} across a
                mix of answer types.
              </p>
            </div>
            <div className="flex justify-between">
              <button
                className="btn-ghost text-sm"
                onClick={() => setStep("method")}
                disabled={loading}
              >
                Back
              </button>
              <button
                className="btn-primary text-sm"
                onClick={() => void handleGenerate()}
                disabled={loading || !topic.trim()}
              >
                {loading ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — cherry-pick from the suggestions, grouped by type */}
        {step === "suggestions" && (
          <>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-dim">
                {selected.size} of {suggestions.length} selected
                {atCap && <span className="text-glow"> · slot limit reached</span>}
              </span>
              <button
                className="btn-ghost px-2 py-1 text-xs"
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0}
              >
                Clear all
              </button>
            </div>

            <div className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1 nice-scroll">
              {groups.map((group) => {
                const allOn = group.indices.every((i) => selected.has(i));
                return (
                  <div key={group.type}>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-xs font-medium uppercase tracking-wider text-dim">
                        {TYPE_LABELS[group.type]}
                      </h4>
                      <button
                        className="text-xs text-iris hover:text-glow disabled:opacity-50"
                        onClick={() => setGroup(group.indices, !allOn)}
                        disabled={!allOn && atCap}
                      >
                        {allOn ? "Clear" : "Select all"}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {group.indices.map((i) => {
                        const suggestion = suggestions[i];
                        const checked = selected.has(i);
                        return (
                          <label
                            key={i}
                            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                              checked ? "border-iris/60 bg-surface" : "border-edge"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 accent-iris"
                              checked={checked}
                              disabled={!checked && atCap}
                              onChange={() => toggle(i)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-fog">{suggestion.text}</span>
                                {!suggestion.required && <span className="tag">Optional</span>}
                              </div>
                              {suggestion.options.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {suggestion.options.map((option, k) => (
                                    <span key={k} className="tag">
                                      {option}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex justify-between border-t border-edge pt-4">
              <button
                className="btn-ghost text-sm"
                onClick={() => setStep("topic")}
                disabled={busy}
              >
                Back
              </button>
              <button
                className="btn-primary text-sm"
                onClick={handleAddSelected}
                disabled={busy || selected.size === 0}
              >
                {busy ? "Adding…" : `Add selected (${selected.size})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One editable question card. Fields save on blur / change. */
function QuestionEditor({
  question,
  index,
  total,
  onMove,
  onDelete,
  onSaved,
}: {
  question: Question;
  index: number;
  total: number;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: (question: Question) => void;
  onSaved: (question: Question) => void;
}) {
  const [text, setText] = useState(question.text);
  const [optionsText, setOptionsText] = useState(question.options.join("\n"));
  const hasOptions = OPTION_TYPES.includes(question.type);

  async function save(changes: Parameters<typeof updateQuestion>[1]) {
    const saved = await updateQuestion(question.id, changes);
    onSaved(saved);
  }

  async function handleTypeChange(type: QuestionType) {
    // Switching to a choice/distribution type needs options; give it a starter pair.
    const options = OPTION_TYPES.includes(type)
      ? question.options.length >= 2
        ? question.options
        : ["Option A", "Option B"]
      : [];
    setOptionsText(options.join("\n"));
    await save({ type, options });
  }

  async function handleOptionsBlur() {
    const options = optionsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (options.length >= 2) await save({ options });
  }

  return (
    <div className="card p-5">
      <div className="flex items-start gap-3">
        <span className="mt-2 w-6 shrink-0 text-right text-sm text-dim">
          {index + 1}.
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <input
            className="input"
            placeholder="e.g. What brought you here today?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() && text !== question.text && save({ text: text.trim() })}
          />

          <div className="flex flex-wrap items-center gap-3">
            <select
              className="input w-auto"
              value={question.type}
              onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
            >
              {(Object.keys(TYPE_LABELS) as QuestionType[]).map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-dim">
              <input
                type="checkbox"
                checked={question.required}
                onChange={(e) => save({ required: e.target.checked })}
                className="accent-[#34d399]"
              />
              Required
            </label>

            {question.type === "rating" && (
              <span className="tag">Scale is always 1–5</span>
            )}
            {question.type === "distribution" && (
              <span className="tag">Respondents split 100 across these</span>
            )}
          </div>

          {hasOptions && (
            <div>
              <label className="label">Options (one per line, at least two)</label>
              <textarea
                className="input resize-none font-mono text-xs"
                rows={Math.max(3, optionsText.split("\n").length)}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                onBlur={handleOptionsBlur}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <button
            className="btn-ghost px-2 py-1 text-xs"
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            className="btn-ghost px-2 py-1 text-xs"
            disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            className="btn-danger px-2 py-1 text-xs"
            onClick={() => onDelete(question)}
            aria-label="Delete question"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
