/** Dashboard: every conversation at a glance, plus "New conversation". */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  createForm,
  deleteForm,
  listForms,
  publicLink,
  updateForm,
} from "../lib/api";
import type { FormListItem } from "../lib/types";

export default function Dashboard() {
  const navigate = useNavigate();
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    listForms()
      .then(setForms)
      .catch(() => navigate("/login"))
      .finally(() => setLoading(false));
  }, [navigate]);

  async function handleCreate() {
    const form = await createForm("New conversation");
    navigate(`/forms/${form.id}/edit`);
  }

  async function handleToggle(item: FormListItem) {
    const updated = await updateForm(item.id, { is_open: !item.is_open });
    setForms((all) =>
      all.map((f) => (f.id === item.id ? { ...f, is_open: updated.is_open } : f)),
    );
  }

  async function handleDelete(item: FormListItem) {
    if (!window.confirm(`Delete "${item.title}" and all its answers?`)) return;
    await deleteForm(item.id);
    setForms((all) => all.filter((f) => f.id !== item.id));
  }

  async function handleCopy(item: FormListItem) {
    await navigator.clipboard.writeText(publicLink(item.slug));
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Conversations</h1>
          <p className="mt-1 text-sm text-dim">
            Collecting answers, one chat at a time.
          </p>
        </div>
        <button className="btn-primary" onClick={handleCreate}>
          + New conversation
        </button>
      </div>

      {loading ? (
        <p className="text-dim">Loading…</p>
      ) : forms.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-lg">Nothing here yet.</p>
          <p className="mt-1 text-sm text-dim">
            Create your first conversation and share the link — respondents
            answer by chatting, not by filling boxes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map((item) => (
            <div
              key={item.id}
              className="card flex flex-wrap items-center gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/forms/${item.id}/edit`}
                  className="font-medium hover:text-mint"
                >
                  {item.title}
                </Link>
                <p className="mt-0.5 text-xs text-dim">
                  {item.question_count} question{item.question_count === 1 ? "" : "s"}
                  {" · "}
                  {item.respondents} respondent{item.respondents === 1 ? "" : "s"}
                  {" · "}
                  {Math.round(item.completion_rate * 100)}% completed
                </p>
              </div>

              <span
                className={`tag ${item.is_open ? "text-mint border-mint/40" : ""}`}
              >
                {item.is_open ? "Open" : "Closed"}
              </span>

              <div className="flex items-center gap-2">
                <button className="btn-ghost text-xs" onClick={() => handleCopy(item)}>
                  {copiedId === item.id ? "Copied!" : "Copy link"}
                </button>
                <button className="btn-ghost text-xs" onClick={() => handleToggle(item)}>
                  {item.is_open ? "Close" : "Reopen"}
                </button>
                <Link className="btn-ghost text-xs" to={`/forms/${item.id}/insights`}>
                  Insights
                </Link>
                <button className="btn-danger text-xs" onClick={() => handleDelete(item)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
