import { MANAGE_NAV, PRIMARY_NAV } from "../../app/navigation";
import { themeBrand, useTheme } from "../../context/ThemeContext";
import { currentUser } from "../../services/gate.service";
import { SidebarItem } from "./SidebarItem";

export function Sidebar() {
  const { theme } = useTheme();
  const role = currentUser()?.role;
  const canSeeCrm = role === "ADMIN" || role === "VIEWER";
  return (
    <aside className="sidebar">
      <div className="sidebar-logo mono">
        <span aria-hidden>💰</span> {themeBrand(theme)}
      </div>
      <nav className="sidebar-nav" aria-label="ניווט ראשי">
        {PRIMARY_NAV.map((item) => (
          <SidebarItem key={item.path} path={item.path} label={item.label} icon={item.icon} />
        ))}
      </nav>
      <nav className="sidebar-nav sidebar-nav-footer" aria-label="הגדרות">
        <SidebarItem path={MANAGE_NAV.path} label={MANAGE_NAV.label} icon={MANAGE_NAV.icon} />
      </nav>
      {/* Separate entry point into the CRM — its own layout, not part of this
          nav's active-route highlighting logic beyond the link itself. Hidden
          for a plain USER account: the real enforcement is server-side
          (requireRole in crm.routes.ts) — this just avoids advertising a
          screen that account can't open. */}
      {canSeeCrm && (
        <nav className="sidebar-nav sidebar-crm-entry" aria-label="CRM">
          <SidebarItem path="/crm/customers" label="CRM · ניהול לקוחות" icon="🗂️" />
        </nav>
      )}
    </aside>
  );
}
