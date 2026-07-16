/** Shell for the creator pages: top bar with logo + logout, guarded by auth. */

import { ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { clearToken, getToken } from "../lib/api";
import Logo from "./Logo";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  // No token → straight to login. The API also 401s, this is just the fast path.
  if (!getToken()) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen">
      <header className="border-b border-edge">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" aria-label="Dashboard">
            <Logo size="text-xl" />
          </Link>
          <button
            className="btn-ghost text-xs"
            onClick={() => {
              clearToken();
              navigate("/login");
            }}
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
