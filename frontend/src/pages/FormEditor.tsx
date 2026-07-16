/** Builder: edit a collection's title, description, and question list. */

import { useEffect, useRef, useState } from "react";
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
import type {
  Form,
  Question,
  QuestionConfig,
  QuestionType,
  SuggestedQuestion,
} from "../lib/types";

const TYPE_LABELS: Record<QuestionType, string> = {
  text: "Free text",
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
  rating: "Rating",
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


export default function FormEditor() {
  const { id = "" } = useParams();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [linkReady, setLinkReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getForm(id).then(setForm).catch(() => setError("Collection not found"));
  }, [id]);

  if (error) return <p className="text-coral-deep">{error}</p>;
  if (!form) return <p className="text-dim">Loading…</p>;

  /** Persist a header field and mirror it in local state. */
  async function saveMeta(changes: Partial<Pick<Form, "title" | "description" | "is_open">>) {
    const updated = await updateForm(id, changes);
    setForm((f) => (f ? { ...f, ...updated, questions: f.questions } : f));
  }

  /** Re-fetch after adding (backend appends at the end), then scroll the newest
   *  question into view so it's obvious it was added. */
  async function handleAdded() {
    const fresh = await getForm(id);
    setForm(fresh);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
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
          ← All collections
        </Link>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={() => saveMeta({ is_open: !form.is_open })}
          >
            {form.is_open ? "Close to answers" : "Reopen"}
          </button>
          <Link className="btn-ghost text-xs" to={`/forms/${id}/insights`}>
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-dim">
          📝 Questions
          <span className="ml-2 normal-case tracking-normal text-dim/70">
            {form.questions.length}/{form.size}
          </span>
        </h2>
        <button
          className="btn-primary text-xs"
          onClick={() => setAdding(true)}
          disabled={form.questions.length >= form.size}
        >
          + Add questions
        </button>
      </div>

      {form.questions.length === 0 ? (
        <div className="card p-10 text-center text-sm text-dim">
          <div className="mb-2 text-4xl">🪄</div>
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

      <div ref={bottomRef} />

      {/* Share section — the chatbot link is generated once the collection is full. */}
      <div className="mt-6">
        {form.questions.length < form.size ? (
          <div className="card p-6 text-center text-sm text-dim">
            🔒 Add all {form.size} questions ({form.questions.length}/{form.size}) to
            generate your shareable chatbot link.
          </div>
        ) : !linkReady ? (
          <div className="card animate-pop-in p-8 text-center">
            <div className="mb-2 text-4xl">🎉</div>
            <p className="mb-1 text-lg font-semibold">Your collection is ready!</p>
            <p className="mb-5 text-sm text-dim">
              Generate the chatbot link and share it — people answer by chatting.
            </p>
            <button className="btn-primary px-8" onClick={() => setLinkReady(true)}>
              ✨ Generate chatbot link
            </button>
          </div>
        ) : (
          <div className="card animate-pop-in p-6">
            <p className="mb-3 text-sm font-medium">🔗 Your chatbot link</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="input flex-1 font-mono text-xs"
                readOnly
                value={publicLink(form.slug)}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="btn-primary shrink-0" onClick={handleCopy}>
                {copied ? "Copied! ✓" : "Copy link"}
              </button>
              <a
                className="btn-ghost shrink-0"
                href={publicLink(form.slug)}
                target="_blank"
                rel="noreferrer"
              >
                Preview ↗
              </a>
            </div>
            <p className="mt-3 text-xs text-dim">
              Anyone with this link can answer. Track responses on the{" "}
              <Link to={`/forms/${id}/insights`} className="text-iris hover:underline">
                insights page
              </Link>
              .
            </p>
          </div>
        )}
      </div>

      {adding && (
        <AddQuestionsModal
          formId={id}
          size={form.size}
          remaining={form.size - form.questions.length}
          onAdded={handleAdded}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/** The add-questions flow: write your own blank questions, or ask the AI for a
 *  batch you cherry-pick from (grouped by question type) to fill the collection. */
function AddQuestionsModal({
  formId,
  size,
  remaining,
  onAdded,
  onClose,
}: {
  formId: string;
  size: number;
  remaining: number;
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  // The total is fixed at creation, so we don't ask "how many" again — the
  // creator just picks a method, and the AI fills the remaining slots.
  type Step = "method" | "topic" | "suggestions";
  const [step, setStep] = useState<Step>("method");
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
      // Backend inserts each new question at the top, so create in reverse to
      // land the first-picked question on top and keep the batch's own order.
      for (const draft of [...drafts].reverse()) {
        await addQuestion(formId, {
          text: draft.text,
          type: draft.type,
          options: draft.options,
          required: draft.required,
          config: {},
        });
      }
      await onAdded();
      onClose();
    } catch {
      setError("Couldn't add the questions. Please try again.");
      setBusy(false);
    }
  }

  function handleWriteOwn() {
    // Add a single blank question the creator fills inline, then repeat as needed.
    void createFrom([
      { text: "Untitled question", type: "text", options: [], required: true },
    ]);
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await suggestQuestions(formId, topic.trim(), remaining);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-fog/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card animate-pop-in flex max-h-[85vh] w-full max-w-2xl flex-col p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-fog">Add questions</h3>
          <button
            className="btn-ghost px-2 py-1 text-xs"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-coral-deep">{error}</p>}

        {/* Step 1 — write your own or ask AI */}
        {step === "method" && (
          <div className="space-y-4">
            <p className="text-sm text-dim">
              {remaining} of {size} question{size === 1 ? "" : "s"} left to add.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className="card p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-iris/50 hover:shadow-lift disabled:opacity-50"
                onClick={handleWriteOwn}
                disabled={busy}
              >
                <div className="font-semibold text-fog">✍️ Write my own</div>
                <div className="mt-1 text-xs text-dim">
                  Add a blank question and fill it in yourself.
                </div>
              </button>
              <button
                className="card p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-glow/50 hover:shadow-lift disabled:opacity-50"
                onClick={() => setStep("topic")}
                disabled={busy}
              >
                <div className="font-semibold gradient-text">✨ Ask AI</div>
                <div className="mt-1 text-xs text-dim">
                  Describe a topic and pick from suggested questions.
                </div>
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
                We'll draft up to {remaining} question{remaining === 1 ? "" : "s"} across
                a mix of answer types — pick the ones you want.
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
                {loading ? "Dreaming up questions… ✨" : "Generate ✨"}
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
                      <h4 className="text-xs font-bold uppercase tracking-wider gradient-text">
                        {TYPE_LABELS[group.type]}
                      </h4>
                      <button
                        className="text-xs font-semibold text-iris hover:text-glow disabled:opacity-50"
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
                            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-all ${
                              checked
                                ? "border-glow/50 bg-glow/5 ring-1 ring-glow/30"
                                : "border-edge bg-white hover:border-iris/40 hover:shadow-soft"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 accent-glow"
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

/** Per-question answer settings, shown only for the types that have any.
 *  Values are held as raw strings while editing and committed (parsed to ints,
 *  blanks dropped) on blur so the creator can clear a field to "no limit". */
function QuestionSettings({
  question,
  onSave,
}: {
  question: Question;
  onSave: (changes: { config: QuestionConfig }) => Promise<void>;
}) {
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(question.config ?? {}).map(([k, v]) => [k, String(v)]),
    ),
  );

  const setField = (key: string, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  /** Parse the given keys into a fresh config and persist it. Blank = omit. */
  function commit(keys: string[]) {
    const config: QuestionConfig = {};
    for (const key of keys) {
      const raw = (fields[key] ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) config[key] = Math.trunc(n);
    }
    void onSave({ config });
  }

  function num(key: string, keys: string[], placeholder: string) {
    return (
      <input
        className="input w-24"
        type="number"
        value={fields[key] ?? ""}
        placeholder={placeholder}
        onChange={(e) => setField(key, e.target.value)}
        onBlur={() => commit(keys)}
      />
    );
  }

  let body: React.ReactNode = null;
  if (question.type === "rating") {
    const keys = ["min_value", "max_value"];
    body = (
      <div className="flex flex-wrap items-center gap-2 text-sm text-dim">
        <span>Scale from</span>
        {num("min_value", keys, "1")}
        <span>to</span>
        {num("max_value", keys, "5")}
      </div>
    );
  } else if (question.type === "text") {
    const keys = ["min_length", "max_length"];
    body = (
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-dim">
          Min characters {num("min_length", keys, "none")}
        </label>
        <label className="flex items-center gap-2 text-sm text-dim">
          Max characters {num("max_length", keys, "none")}
        </label>
      </div>
    );
  } else if (question.type === "number") {
    const keys = ["min_value", "max_value"];
    body = (
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-dim">
          Min value {num("min_value", keys, "none")}
        </label>
        <label className="flex items-center gap-2 text-sm text-dim">
          Max value {num("max_value", keys, "none")}
        </label>
      </div>
    );
  } else if (question.type === "multi_choice") {
    body = (
      <label className="flex items-center gap-2 text-sm text-dim">
        Max selections {num("max_choices", ["max_choices"], "any")}
      </label>
    );
  }

  if (!body) return null;

  return (
    <div className="rounded-2xl border border-edge bg-surface/50 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-dim">
        Settings
      </div>
      {body}
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
  // Local, editable copy of the options list. Each option is its own field.
  const [options, setOptions] = useState<string[]>(question.options);
  const hasOptions = OPTION_TYPES.includes(question.type);

  async function save(changes: Parameters<typeof updateQuestion>[1]) {
    const saved = await updateQuestion(question.id, changes);
    onSaved(saved);
  }

  async function handleTypeChange(type: QuestionType) {
    // Switching to a choice/distribution type needs options; give it a starter pair.
    const next = OPTION_TYPES.includes(type)
      ? question.options.length >= 2
        ? question.options
        : ["Option A", "Option B"]
      : [];
    setOptions(next);
    await save({ type, options: next });
  }

  // Persist the options list, but only when it's still valid (>= 2 non-empty).
  async function persistOptions(next: string[]) {
    const cleaned = next.map((o) => o.trim()).filter(Boolean);
    if (cleaned.length >= 2) await save({ options: cleaned });
  }

  function updateOption(i: number, value: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  }

  function addOption() {
    setOptions((prev) => [...prev, ""]);
  }

  async function removeOption(i: number) {
    const next = options.filter((_, idx) => idx !== i);
    setOptions(next);
    await persistOptions(next);
  }

  return (
    <div className="card animate-fade-in-up p-5 transition-shadow hover:shadow-lift">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signature text-xs font-bold text-white">
          {index + 1}
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
                className="accent-glow"
              />
              Required
            </label>

            {question.type === "distribution" && (
              <span className="tag">Respondents split 100 across these</span>
            )}
          </div>

          <QuestionSettings question={question} onSave={save} />

          {hasOptions && (
            <div>
              <label className="label">Options (at least two)</label>
              <div className="space-y-2">
                {options.map((option, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-center text-xs text-dim">
                      {i + 1}
                    </span>
                    <input
                      className="input flex-1"
                      placeholder={`Option ${i + 1}`}
                      value={option}
                      onChange={(e) => updateOption(i, e.target.value)}
                      onBlur={() => persistOptions(options)}
                    />
                    <button
                      type="button"
                      className="btn-danger px-2 py-1 text-xs"
                      onClick={() => removeOption(i)}
                      disabled={options.length <= 2}
                      aria-label="Remove option"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="mt-2 flex items-center gap-1.5 rounded-full bg-iris/10 px-3 py-1 text-xs font-semibold text-iris transition-all hover:bg-iris/20 active:scale-95"
                onClick={addOption}
              >
                + Add option
              </button>
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
