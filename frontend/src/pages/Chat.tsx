/** Public respondent page (/f/:slug).
 *
 *  A smooth, backend-driven interview: the server tells us which question is
 *  current and how far along we are; we render a type-aware answer widget for
 *  it. Left sidebar = progress + a clickable question list (jump back to edit);
 *  right = the chat itself. On mobile the sidebar collapses to a top bar.
 */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import confetti from "canvas-confetti";

import Logo from "../components/Logo";
import { ApiError, getPublicForm, sendChat } from "../lib/api";
import type { CurrentQuestion, ChatProgress, PublicForm } from "../lib/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

/** What we've learned about a question by having landed on it at least once. */
interface SeenQuestion {
  id: string;
  text: string;
}

export default function Chat() {
  const { slug = "" } = useParams();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [current, setCurrent] = useState<CurrentQuestion | null>(null);
  const [progress, setProgress] = useState<ChatProgress | null>(null);
  const [seen, setSeen] = useState<Record<number, SeenQuestion>>({});
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());

  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false); // AI is "typing"
  const [done, setDone] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPublicForm(slug).then(setForm).catch(() => setNotFound(true));
  }, [slug]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, waiting]);

  useEffect(() => {
    if (!waiting && sessionId && !done) inputRef.current?.focus();
  }, [waiting, sessionId, done, current]);

  // Celebrate completion with a confetti burst in Parlo's gradient colors.
  useEffect(() => {
    if (!done) return;
    const colors = ["#7c3aed", "#d946ef", "#fb7185"];
    confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, colors });
    const t = setTimeout(
      () => confetti({ particleCount: 60, spread: 100, origin: { y: 0.5 }, colors, scalar: 0.9 }),
      250,
    );
    return () => clearTimeout(t);
  }, [done]);

  const started = sessionId !== null || messages.length > 0;

  /** One round-trip to the chat API, folding the reply into local state. */
  async function callChat(opts: {
    message: string | null;
    gotoId?: string | null;
    answeringId?: string | null;
  }) {
    const prevAnswered = progress?.answered ?? 0;
    setWaiting(true);
    setMobileListOpen(false);
    try {
      const res = await sendChat(slug, sessionId, opts.message, opts.gotoId ?? null);
      setSessionId(res.session_id);
      setMessages((all) => [...all, { role: "assistant", content: res.reply }]);
      setCurrent(res.question);
      setProgress(res.progress);
      if (res.question) {
        setSeen((s) => ({
          ...s,
          [res.question!.position]: { id: res.question!.id, text: res.question!.text },
        }));
      }
      // A recorded answer (progress ticked up) confirms the question we were on.
      if (opts.answeringId && res.progress.answered > prevAnswered) {
        setAnsweredIds((s) => new Set(s).add(opts.answeringId!));
      }
      if (res.done) setDone(true);
    } catch (err) {
      const text =
        err instanceof ApiError ? err.message : "Something went wrong — please try again.";
      setMessages((all) => [...all, { role: "assistant", content: text }]);
    } finally {
      setWaiting(false);
    }
  }

  function handleStart() {
    void callChat({ message: null });
  }

  /** Submit a value chosen through a widget: show it as a bubble, then send. */
  function submitAnswer(message: string, bubble: string) {
    if (waiting || done || !current) return;
    setMessages((all) => [...all, { role: "user", content: bubble }]);
    setDraft("");
    void callChat({ message, answeringId: current.id });
  }

  function handleFreeText(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || waiting || done) return;
    setMessages((all) => [...all, { role: "user", content: message }]);
    setDraft("");
    void callChat({ message, answeringId: current?.id ?? null });
  }

  function handleHelp() {
    if (waiting || done || !current) return;
    setMessages((all) => [...all, { role: "user", content: "help" }]);
    void callChat({ message: "help", answeringId: null });
  }

  function handleEdit(q: SeenQuestion, position: number) {
    if (waiting || done) return;
    setMessages((all) => [...all, { role: "user", content: `Edit question ${position}` }]);
    void callChat({ message: null, gotoId: q.id });
  }

  if (notFound) {
    return (
      <CenteredShell>
        <div className="card p-10 text-center">
          <p className="text-lg">This collection doesn't exist.</p>
          <p className="mt-1 text-sm text-dim">Double-check the link you were sent.</p>
        </div>
      </CenteredShell>
    );
  }

  if (!form) {
    return (
      <CenteredShell>
        <p className="text-center text-dim">Loading…</p>
      </CenteredShell>
    );
  }

  // ----- intro card, before the chat starts -----
  if (!started) {
    return (
      <CenteredShell>
        <div className="card p-8 text-center sm:p-10">
          <h1 className="text-2xl font-semibold">{form.title}</h1>
          {form.description && <p className="mt-3 text-dim">{form.description}</p>}
          <p className="mx-auto mt-4 max-w-sm text-sm text-dim">
            You'll answer{" "}
            <span className="font-semibold text-fog">
              {form.question_count} question{form.question_count === 1 ? "" : "s"}
            </span>{" "}
            about this — answer by tapping or typing, at your pace.
          </p>
          {form.is_open ? (
            <button className="btn-primary mt-8 px-8" onClick={handleStart} disabled={waiting}>
              {waiting ? "One moment…" : "Start"}
            </button>
          ) : (
            <p className="mt-8 text-sm text-glow">
              This collection is closed and no longer accepting answers.
            </p>
          )}
        </div>
      </CenteredShell>
    );
  }

  // ----- the live interview: sidebar + chat -----
  const questionList = (
    <QuestionList
      total={progress?.total ?? form.question_count}
      seen={seen}
      answeredIds={answeredIds}
      currentId={done ? null : current?.id ?? null}
      done={done}
      onEdit={handleEdit}
      disabled={waiting}
    />
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl">
      {/* Sidebar — desktop */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col gap-6 border-r border-edge bg-surface/40 p-5 md:flex">
        <Logo size="text-lg" />
        <ProgressBlock progress={progress} done={done} />
        <div className="nice-scroll -mr-2 flex-1 overflow-y-auto pr-2">{questionList}</div>
        <p className="text-xs leading-relaxed text-dim">
          Type <span className="text-iris">"help"</span> to rephrase a question, or click an
          answered question to edit it.
        </p>
      </aside>

      {/* Main — chat */}
      <main className="flex min-h-screen flex-1 flex-col px-4 py-4 sm:px-6">
        {/* Mobile top bar */}
        <div className="mb-3 md:hidden">
          <div className="flex items-center justify-between">
            <Logo size="text-base" />
            <button
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() => setMobileListOpen((v) => !v)}
            >
              {mobileListOpen ? "Hide" : "Questions"}
            </button>
          </div>
          <div className="mt-3">
            <ProgressBlock progress={progress} done={done} />
          </div>
          {mobileListOpen && (
            <div className="card mt-3 max-h-72 overflow-y-auto p-3">{questionList}</div>
          )}
        </div>

        <div className="nice-scroll flex-1 space-y-3 overflow-y-auto pb-4 pr-1">
          {messages.map((message, i) => (
            <Bubble key={i} message={message} />
          ))}
          {waiting && <TypingIndicator />}
          {done && <DonePanel />}
          <div ref={bottomRef} />
        </div>

        {!done && (
          <div className="border-t border-edge pt-3">
            {current && (
              <div className="mb-3">
                <AnswerWidget key={current.id} question={current} onSubmit={submitAnswer} disabled={waiting} />
              </div>
            )}
            <form onSubmit={handleFreeText} className="flex gap-2">
              <input
                ref={inputRef}
                className="input flex-1"
                placeholder="Type an answer, or 'help'…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={waiting}
                aria-label="Your answer"
              />
              <button
                type="button"
                className="btn-ghost px-3"
                onClick={handleHelp}
                disabled={waiting || !current}
                title="Rephrase the current question"
              >
                Help
              </button>
              <button className="btn-primary" disabled={waiting || !draft.trim()}>
                Send
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

/** Centered single-column layout for the loading / intro / error states. */
function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6">
      <div className="mb-6 text-center">
        <Logo size="text-lg" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Progress + question list
// --------------------------------------------------------------------------- //

function ProgressBlock({ progress, done }: { progress: ChatProgress | null; done: boolean }) {
  const answered = progress?.answered ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-dim">{done ? "Complete" : "Progress"}</span>
        <span className="font-medium text-fog">
          {answered}/{total} answered
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge">
        <div
          className="h-full rounded-full bg-iris transition-all duration-500 ease-out"
          style={{ width: `${done ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}

function QuestionList({
  total,
  seen,
  answeredIds,
  currentId,
  done,
  onEdit,
  disabled,
}: {
  total: number;
  seen: Record<number, SeenQuestion>;
  answeredIds: Set<string>;
  currentId: string | null;
  done: boolean;
  onEdit: (q: SeenQuestion, position: number) => void;
  disabled: boolean;
}) {
  const rows = useMemo(
    () => Array.from({ length: total }, (_, i) => i + 1),
    [total],
  );
  return (
    <ul className="space-y-1">
      {rows.map((position) => {
        const q = seen[position];
        const isAnswered = q ? answeredIds.has(q.id) : false;
        const isCurrent = q ? q.id === currentId : false;
        const label = q ? truncate(q.text, 40) : `Question ${position}`;
        const clickable = isAnswered && !disabled && !isCurrent;

        return (
          <li key={position}>
            <button
              type="button"
              onClick={() => clickable && q && onEdit(q, position)}
              disabled={!clickable}
              className={rowClass(isCurrent, isAnswered, clickable)}
            >
              <span className={badgeClass(isCurrent, isAnswered)}>
                {isAnswered && !isCurrent ? "✓" : position}
              </span>
              <span className="flex-1 truncate">{label}</span>
              {clickable && <span className="text-[10px] text-dim">Edit</span>}
            </button>
          </li>
        );
      })}
      {done && (
        <li className="px-2 pt-2 text-xs text-iris">All questions answered.</li>
      )}
    </ul>
  );
}

function rowClass(isCurrent: boolean, isAnswered: boolean, clickable: boolean): string {
  const base =
    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors";
  if (isCurrent) return `${base} bg-iris/15 text-fog ring-1 ring-iris/40`;
  if (isAnswered)
    return `${base} text-dim ${clickable ? "hover:bg-card hover:text-fog" : ""}`;
  return `${base} text-dim/50 cursor-default`;
}

function badgeClass(isCurrent: boolean, isAnswered: boolean): string {
  const base =
    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium";
  if (isCurrent) return `${base} bg-iris text-ink`;
  if (isAnswered) return `${base} bg-iris/20 text-iris`;
  return `${base} border border-edge text-dim/60`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// --------------------------------------------------------------------------- //
// Chat bubbles
// --------------------------------------------------------------------------- //

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "rounded-br-md border border-iris/25 bg-iris/15 text-fog"
            : "rounded-bl-md border border-edge bg-card"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-edge bg-card px-4 py-3">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-dim" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-dim" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-dim" />
      </div>
    </div>
  );
}

function DonePanel() {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-iris/15 text-2xl text-iris ring-1 ring-iris/40">
        ✓
      </div>
      <div>
        <p className="text-lg font-semibold text-fog">All done — thanks!</p>
        <p className="mt-1 text-sm text-dim">
          Your answers have been recorded. You can close this page now.
        </p>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Type-aware answer widgets
// --------------------------------------------------------------------------- //

function AnswerWidget({
  question,
  onSubmit,
  disabled,
}: {
  question: CurrentQuestion;
  onSubmit: (message: string, bubble: string) => void;
  disabled: boolean;
}) {
  switch (question.type) {
    case "single_choice":
      return <SingleChoice question={question} onSubmit={onSubmit} disabled={disabled} />;
    case "multi_choice":
      return <MultiChoice question={question} onSubmit={onSubmit} disabled={disabled} />;
    case "rating":
      return <Rating onSubmit={onSubmit} disabled={disabled} />;
    case "distribution":
      return <Distribution question={question} onSubmit={onSubmit} disabled={disabled} />;
    case "number":
      return <ScalarInput kind="number" onSubmit={onSubmit} disabled={disabled} />;
    case "email":
      return <ScalarInput kind="email" onSubmit={onSubmit} disabled={disabled} />;
    default:
      return null; // `text` uses the always-present free-text input below
  }
}

const chip =
  "rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50";

function SingleChoice({
  question,
  onSubmit,
  disabled,
}: {
  question: CurrentQuestion;
  onSubmit: (m: string, b: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {question.options.map((opt) => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(opt, opt)}
          className={`${chip} border-edge bg-card text-fog hover:border-iris/60 hover:bg-iris/10`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function MultiChoice({
  question,
  onSubmit,
  disabled,
}: {
  question: CurrentQuestion;
  onSubmit: (m: string, b: string) => void;
  disabled: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  function toggle(opt: string) {
    setPicked((cur) =>
      cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt],
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {question.options.map((opt) => {
          const on = picked.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => toggle(opt)}
              className={`${chip} ${
                on
                  ? "border-iris bg-iris/20 text-fog"
                  : "border-edge bg-card text-fog hover:border-iris/60"
              }`}
            >
              {on ? "✓ " : ""}
              {opt}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={disabled || picked.length === 0}
        onClick={() => onSubmit(JSON.stringify(picked), picked.join(", "))}
      >
        Next
      </button>
    </div>
  );
}

function Rating({
  onSubmit,
  disabled,
}: {
  onSubmit: (m: string, b: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(String(n), `${n} / 5`)}
          className={`${chip} h-11 w-11 border-edge bg-card text-base text-fog hover:border-iris/60 hover:bg-iris/10`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function ScalarInput({
  kind,
  onSubmit,
  disabled,
}: {
  kind: "number" | "email";
  onSubmit: (m: string, b: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const v = value.trim();
    if (!v) return;
    onSubmit(v, v);
    setValue("");
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        className="input flex-1"
        type={kind === "number" ? "number" : "email"}
        inputMode={kind === "number" ? "decimal" : "email"}
        placeholder={kind === "number" ? "Enter a number" : "you@example.com"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
      />
      <button className="btn-primary" disabled={disabled || !value.trim()}>
        Submit
      </button>
    </form>
  );
}

function Distribution({
  question,
  onSubmit,
  disabled,
}: {
  question: CurrentQuestion;
  onSubmit: (m: string, b: string) => void;
  disabled: boolean;
}) {
  const [alloc, setAlloc] = useState<Record<string, string>>(
    () => Object.fromEntries(question.options.map((o) => [o, ""])),
  );
  const total = question.options.reduce((sum, o) => sum + (Number(alloc[o]) || 0), 0);
  const exact = Math.abs(total - 100) < 0.001;

  function setOne(opt: string, raw: string) {
    setAlloc((cur) => ({ ...cur, [opt]: raw }));
  }
  function submit() {
    const obj: Record<string, number> = {};
    for (const o of question.options) obj[o] = Number(alloc[o]) || 0;
    const bubble = question.options.map((o) => `${o}: ${obj[o]}`).join(", ");
    onSubmit(JSON.stringify(obj), bubble);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {question.options.map((opt) => (
          <div key={opt} className="flex items-center gap-3">
            <span className="flex-1 truncate text-sm text-fog">{opt}</span>
            <input
              className="input w-24 text-right"
              type="number"
              min={0}
              max={100}
              placeholder="0"
              value={alloc[opt]}
              onChange={(e) => setOne(opt, e.target.value)}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium ${exact ? "text-iris" : "text-dim"}`}>
          {total}/100 points
        </span>
        <button
          type="button"
          className="btn-primary"
          disabled={disabled || !exact}
          onClick={submit}
        >
          Submit
        </button>
      </div>
    </div>
  );
}
