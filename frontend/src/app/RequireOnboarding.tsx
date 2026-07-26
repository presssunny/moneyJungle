import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loading } from "../components/common/Loading";
import { getSummary } from "../services/dashboard.service";
import { completeOnboarding, getSettings, isOnboardingComplete } from "../services/planning.service";

type Status = "loading" | "ok" | "needs-onboarding";

export const ONBOARDED_KEY = "mj_onboarded";

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Gate the app on first-run onboarding. Once onboarded we cache a localStorage
 * flag so subsequent loads skip the settings round-trip (no loading flash).
 * A user who already has data is treated as onboarded — we never nag an existing
 * account with the welcome wizard. Fails open so the user is never trapped.
 */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() =>
    localStorage.getItem(ONBOARDED_KEY) === "1" ? "ok" : "loading"
  );

  useEffect(() => {
    if (status === "ok") return;
    let alive = true;

    Promise.all([getSettings(), getSummary(currentMonthKey()).catch(() => null)])
      .then(([settings, summary]) => {
        if (!alive) return;
        const hasData =
          !!summary && (summary.incomeTotal > 0 || summary.expenseTotal > 0 || summary.creditTotal > 0);
        if (isOnboardingComplete(settings) || hasData) {
          localStorage.setItem(ONBOARDED_KEY, "1");
          // Deliberately silent (fail-open): this is a background write of a
          // convenience flag. The local flag is already set, so the user is in;
          // blocking or alarming her over a bookkeeping PATCH would be wrong.
          if (!isOnboardingComplete(settings)) completeOnboarding(settings).catch(() => {});
          setStatus("ok");
        } else {
          setStatus("needs-onboarding");
        }
      })
      .catch(() => {
        if (alive) setStatus("ok"); // fail open
      });

    return () => {
      alive = false;
    };
  }, [status]);

  if (status === "loading") return <Loading />;
  if (status === "needs-onboarding") return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
