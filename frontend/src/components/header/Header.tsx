import { NavLink, useLocation } from "react-router-dom";
import { MANAGE_NAV, routeTitle } from "../../app/navigation";
import { useGateAuth } from "../../hooks/useGateAuth";

/**
 * Title + account actions only. The month picker moved to the sticky FilterBar
 * below (IA §2.3) so all global filters live in one row, on every tab.
 */
export function Header() {
  const location = useLocation();
  const { logout } = useGateAuth();
  const current = routeTitle(location.pathname);

  return (
    <header className="header">
      <h1 className="header-title">
        <span aria-hidden>{current?.icon}</span> {current?.label ?? ""}
      </h1>
      <div className="header-actions">
        <NavLink to={MANAGE_NAV.path} className="header-icon-btn" title={MANAGE_NAV.label} aria-label={MANAGE_NAV.label}>
          {MANAGE_NAV.icon}
        </NavLink>
        <button className="header-logout" onClick={logout} title="יציאה">
          יציאה ⎋
        </button>
      </div>
    </header>
  );
}
