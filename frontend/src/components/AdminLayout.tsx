/** Shell for the creator pages: top bar with logo, current email + usage, and
 *  an "Exit" button that switches email. Guarded by the presence of a token. */

import { ReactNode, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { clearToken, getMe, getToken, type Me } from "../lib/api";
import Logo from "./Logo";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const token = getToken();
  const [me, setMe] = useState<Me | null>(null);

  // Refresh usage on navigation AND whenever a page signals it changed the count
  // (e.g. deleting a collection stays on the dashboard, so there's no navigation).
  useEffect(() => {
    if (!token) return;
    const load = () => getMe().then(setMe).catch(() => setMe(null));
    load();
    window.addEventListener("parlo:usage-changed", load);
    return () => window.removeEventListener("parlo:usage-changed", load);
  }, [token, location.pathname]);

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
