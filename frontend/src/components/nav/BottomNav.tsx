import { NavLink } from "react-router-dom";
import { MANAGE_NAV, PRIMARY_NAV } from "../../app/navigation";

/**
 * Mobile bottom tab bar (hidden on desktop via CSS). Shows 4 daily destinations
 * plus the manage hub = 5 targets, within the ≤5 mobile-nav guideline. Reports is
 * reachable from the manage hub / dashboard on small screens.
 */
const ITEMS = [PRIMARY_NAV[0], PRIMARY_NAV[1], PRIMARY_NAV[2], PRIMARY_NAV[3], MANAGE_NAV];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="ניווט תחתון">
      {ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/"}
          className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item-active" : ""}`}
        >
          <span className="bottom-nav-icon" aria-hidden>
            {item.icon}
          </span>
          <span className="bottom-nav-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
