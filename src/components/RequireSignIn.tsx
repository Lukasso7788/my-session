import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Pages for members only: signed-out visitors go to sign in and come back
// to the same page afterwards.
export default function RequireSignIn({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { pathname, search } = useLocation();

  if (loading) return <div className="min-h-[60vh]" aria-busy="true" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(`${pathname}${search}`)}`} replace />;
  return <>{children}</>;
}
