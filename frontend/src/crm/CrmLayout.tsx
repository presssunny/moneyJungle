import { Link, Outlet } from "react-router-dom";
import { Toaster } from "../components/common/Toaster";

/**
 * The CRM's own shell — no Sidebar, no BottomNav, no FilterBar from the
 * customer-facing app. That separation is deliberate (see crm.routes.ts on
 * the backend and App.tsx, where /crm sits outside <AppLayout>): the CRM is
 * an internal, operator-facing tool, not another tab of the household app.
 * It reuses the same design tokens (colors, fonts) so it still looks like
 * part of the same product, and the same gate login — there is no separate
 * CRM auth system.
 */
export function CrmLayout() {
  return (
    <div className="crm-shell">
      <header className="crm-topbar">
        <div className="crm-topbar-brand">
          <span aria-hidden>🗂️</span> CRM · ניהול לקוחות
        </div>
        <Link to="/" className="crm-topbar-back">
          ‹ חזרה לאפליקציה
        </Link>
      </header>
      <main className="crm-content" id="crm-main-content">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
