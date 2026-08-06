import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { setAnalyticsUser, trackRoute } from "../lib/analytics";

export default function AnalyticsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, loading } = useAuth();

  useLayoutEffect(() => {
    trackRoute(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    if (!loading) setAnalyticsUser(user?.id ?? null);
  }, [loading, user?.id]);

  return children;
}
