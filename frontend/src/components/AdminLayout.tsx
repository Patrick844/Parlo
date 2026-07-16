/** Shell for the creator pages: top bar with logo, current email + usage, and
 *  an "Exit" button that switches email. Guarded by the presence of a token. */

import { ReactNode, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { clearToken, getMe, getToken, type Me } from "../lib/api";
import Logo from "./Logo";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const token = getToken();
  const [me, setMe] = useState<Me | null>(null);

  // Load the current guest + usage for the header (best-effort).
  useEffect(() => {
    if (token) getMe().then(setMe).catch(() => setMe(null));
  }, [token]);

  // No token → straight to the entry page. The API also 401s; this is the fast path.
  if (!token) return <Navigate to="/login" replace />;

  function exit() {
    clearToken();
    navigate("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-edge bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-4">
          <Link to="/" aria-label="Dashboard">
            <Logo size="text-xl" />
          </Link>
          <div className="flex items-center gap-3">
            {me && (
              <div className="hidden items-center gap-2 text-xs text-dim sm:flex">
                <span className="font-medium text-fog">{me.email}</span>
                <span className="tag border-iris/30 bg-iris/10 text-iris">
                  {me.collections_used}/{me.collections_max} collections
                </span>
              </div>
            )}
            <button
              className="btn-ghost text-xs"
              onClick={exit}
              title="Clear this session and switch email"
            >
              Exit
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
