/** Creator login: one password, one dark card. */

import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import Logo from "../components/Logo";
import { ApiError, login } from "../lib/api";

export default function Login() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(password);
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
        <p className="mb-8 text-center text-sm text-dim">
          👋 Ask anything. Just talk.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="Your creator password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-coral-deep">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in ✨"}
          </button>
        </form>
      </div>
    </div>
  );
}
