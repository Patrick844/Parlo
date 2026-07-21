/** Guest entry: one email field, no password. Enter an email → your workspace. */

import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import Logo from "../components/Logo";
import { ApiError, enter, getToken } from "../lib/api";
import { identify, track } from "../lib/analytics";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already have a token? Skip straight to the dashboard.
  useEffect(() => {
    if (getToken()) navigate("/", { replace: true });
  }, [navigate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const clean = email.trim();
      await enter(clean);
      identify(clean);
      track("signed_in");
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="card animate-pop-in w-full max-w-sm p-8">
        <div className="mb-1 text-center">
          <Logo size="text-4xl" />
        </div>
        <p className="mb-6 text-center text-sm text-dim">
          👋 Collecting answers, one chat at a time.
        </p>

        {/* Friendly fair-use note. */}
        <div className="mb-6 rounded-2xl border border-iris/20 bg-iris/5 px-4 py-3 text-xs text-dim">
          <p className="font-medium text-iris">
            ✨ Free to use — sign in with just your email, no password needed.
          </p>
          <p className="mt-1">Fair-use limits: 1 collection and up to 25 AI generations per day.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Your email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <p className="mt-1.5 text-xs text-dim">
              No password needed — your email is your workspace.
            </p>
          </div>
          {error && <p className="text-sm text-coral-deep">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || !email.trim()}>
            {busy ? "Setting up…" : "Continue →"}
          </button>
        </form>
      </div>
    </div>
  );
}
