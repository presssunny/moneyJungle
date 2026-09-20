import { Icon } from "../common/Icon";
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
        {current?.label ?? ""}
      </h1>
      <div className="header-actions">
        <NavLink to="/imports" className="btn btn-ghost btn-sm"><Icon name="upload"/>העלאת מידע</NavLink>
        <NavLink to={MANAGE_NAV.path} className="header-icon-btn" title={MANAGE_NAV.label} aria-label={MANAGE_NAV.label}>
          <Icon name="settings"/>
        </NavLink>
        <button className="header-logout" onClick={logout} title="יציאה" aria-label="יציאה">
          <Icon name="logout"/><span className="header-logout-label">יציאה</span>
        </button>
      </div>
    </header>
  );
}
