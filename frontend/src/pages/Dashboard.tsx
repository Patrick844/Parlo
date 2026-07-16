/** Dashboard: every collection at a glance, plus "New collection". */

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

const SIZE_PRESETS = [5, 10, 20];

export default function Dashboard() {
  const navigate = useNavigate();
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listForms()
      .then(setForms)
      .catch(() => navigate("/login"))
      .finally(() => setLoading(false));
  }, [navigate]);

  async function handleCreate(title: string, size: number) {
    const form = await createForm(title, size);
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
          <h1 className="text-2xl font-semibold">Collections</h1>
          <p className="mt-1 text-sm text-dim">
            Collecting answers, one chat at a time.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          + New collection
        </button>
      </div>

      {loading ? (
        <p className="text-dim">Loading…</p>
      ) : forms.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-lg">Nothing here yet.</p>
          <p className="mt-1 text-sm text-dim">
            Create your first collection and share the link — respondents
            answer by chatting, not by filling boxes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map((item) => {
            const full = item.question_count >= item.size;
            return (
              <div
                key={item.id}
                className="card flex flex-wrap items-center gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/forms/${item.id}/edit`}
                    className="font-medium hover:text-iris"
                  >
                    {item.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-dim">
                    {item.question_count}/{item.size} questions
                    {" · "}
                    {item.respondents} respondent{item.respondents === 1 ? "" : "s"}
                    {" · "}
                    {Math.round(item.completion_rate * 100)}% completed
                  </p>
                </div>

                <span
                  className={`tag ${item.is_open ? "text-iris border-iris/40" : ""}`}
                >
                  {item.is_open ? "Open" : "Closed"}
                </span>

                <div className="flex items-center gap-2">
                  {/* Sharing unlocks only once every question slot is filled. */}
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => handleCopy(item)}
                    disabled={!full}
                    title={full ? "" : `Add all ${item.size} questions to share`}
                  >
                    {copiedId === item.id ? "Copied!" : full ? "Copy link" : "Locked"}
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
            );
          })}
        </div>
      )}

      {creating && (
        <NewCollectionModal
          onCreate={handleCreate}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

/** Ask for a title and the total number of questions before creating. */
function NewCollectionModal({
  onCreate,
  onClose,
}: {
  onCreate: (title: string, size: number) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [size, setSize] = useState(10);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await onCreate(title.trim() || "Untitled collection", size);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
      onClick={onClose}
    >
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">New collection</h2>

        <label className="label">Name</label>
        <input
          className="input mb-5"
          placeholder="e.g. Customer feedback"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="label">How many questions in total?</label>
        <div className="mb-2 flex gap-2">
          {SIZE_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className={`btn flex-1 ${size === n ? "bg-iris text-ink" : "border border-edge text-dim hover:text-fog"}`}
              onClick={() => setSize(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-dim">
          <span>Or a custom number:</span>
          <input
            type="number"
            min={1}
            max={50}
            className="input w-20"
            value={size}
            onChange={(e) => setSize(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost text-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary text-sm" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
