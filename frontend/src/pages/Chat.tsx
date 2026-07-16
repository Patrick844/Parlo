/** Public respondent page (/f/:slug): intro card, then a chat with the AI. */

import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import Logo from "../components/Logo";
import { ApiError, getPublicForm, sendChat } from "../lib/api";
import type { PublicForm } from "../lib/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function Chat() {
  const { slug = "" } = useParams();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false); // AI is "typing"
  const [done, setDone] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPublicForm(slug).then(setForm).catch(() => setNotFound(true));
  }, [slug]);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, waiting]);

  // Hand focus back to the input once the AI has replied.
  useEffect(() => {
    if (!waiting && sessionId && !done) inputRef.current?.focus();
  }, [waiting, sessionId, done]);

  async function callChat(message: string | null) {
    setWaiting(true);
    try {
      const response = await sendChat(slug, sessionId, message);
      setSessionId(response.session_id);
      setMessages((all) => [...all, { role: "assistant", content: response.reply }]);
      if (response.done) setDone(true);
    } catch (err) {
      const text =
        err instanceof ApiError
          ? err.message
          : "Something went wrong — please try again.";
      setMessages((all) => [...all, { role: "assistant", content: text }]);
    } finally {
      setWaiting(false);
    }
  }

  function handleStart() {
    void callChat(null);
  }

  function handleSend(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || waiting || done) return;
    setMessages((all) => [...all, { role: "user", content: message }]);
    setDraft("");
    void callChat(message);
  }

  if (notFound) {
    return (
      <Shell>
        <div className="card p-10 text-center">
          <p className="text-lg">This conversation doesn't exist.</p>
          <p className="mt-1 text-sm text-dim">Double-check the link you were sent.</p>
        </div>
      </Shell>
    );
  }

  if (!form) {
    return (
      <Shell>
        <p className="text-center text-dim">Loading…</p>
      </Shell>
    );
  }

  // ----- intro card, before the chat starts -----
  if (sessionId === null && messages.length === 0) {
    return (
      <Shell>
        <div className="card p-8 text-center sm:p-10">
          <h1 className="text-2xl font-semibold">{form.title}</h1>
          {form.description && <p className="mt-3 text-dim">{form.description}</p>}
          <p className="mt-3 text-xs text-dim">
            {form.question_count} question{form.question_count === 1 ? "" : "s"} · answered
            by chatting, at your own pace
          </p>
          {form.is_open ? (
            <button className="btn-primary mt-8 px-8" onClick={handleStart} disabled={waiting}>
              {waiting ? "One moment…" : "Start"}
            </button>
          ) : (
            <p className="mt-8 text-sm text-glow">
              This conversation is no longer collecting answers.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  // ----- the chat itself -----
  return (
    <Shell>
      <div className="flex h-[calc(100vh-8rem)] flex-col">
        <div className="nice-scroll flex-1 space-y-3 overflow-y-auto pb-4 pr-1">
          {messages.map((message, i) => (
            <Bubble key={i} message={message} />
          ))}
          {waiting && <TypingIndicator />}
          {done && (
            <div className="pt-4 text-center">
              <p className="text-sm text-iris">All done — thanks for chatting!</p>
              <p className="mt-1 text-xs text-dim">You can close this page now.</p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} className="flex gap-2 pt-3">
          <input
            ref={inputRef}
            className="input flex-1"
            placeholder={done ? "This conversation is finished" : "Type your answer…"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={waiting || done}
            aria-label="Your answer"
          />
          <button className="btn-primary" disabled={waiting || done || !draft.trim()}>
            Send
          </button>
        </form>
      </div>
    </Shell>
  );
}

/** Centered column with the Parlo mark up top — shared by every state. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6">
      <div className="mb-6 text-center">
        <Logo size="text-lg" />
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "rounded-br-md bg-iris/15 text-fog border border-iris/25"
            : "rounded-bl-md bg-card border border-edge"
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
