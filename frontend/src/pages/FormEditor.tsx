/** Builder: edit a conversation's title, description, and question list. */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  addQuestion,
  deleteQuestion,
  getForm,
  publicLink,
  reorderQuestions,
  updateForm,
  updateQuestion,
} from "../lib/api";
import type { Form, Question, QuestionType } from "../lib/types";

const TYPE_LABELS: Record<QuestionType, string> = {
  text: "Free text",
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
  rating: "Rating (1–5)",
  number: "Number",
  email: "Email",
};

const CHOICE_TYPES: QuestionType[] = ["single_choice", "multi_choice"];

export default function FormEditor() {
  const { id = "" } = useParams();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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

  async function handleAdd() {
    const question = await addQuestion(id, {
      text: "Untitled question",
      type: "text",
      options: [],
      required: true,
    });
    setForm((f) => (f ? { ...f, questions: [...f.questions, question] } : f));
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
        </h2>
        <button className="btn-primary text-xs" onClick={handleAdd}>
          + Add question
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
  const isChoice = CHOICE_TYPES.includes(question.type);

  async function save(changes: Parameters<typeof updateQuestion>[1]) {
    const saved = await updateQuestion(question.id, changes);
    onSaved(saved);
  }

  async function handleTypeChange(type: QuestionType) {
    // Switching to a choice type needs options; give it a starter pair.
    const options = CHOICE_TYPES.includes(type)
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
          </div>

          {isChoice && (
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
