import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MANAGE_NAV, PRIMARY_NAV } from "../../app/navigation";

/**
 * Mobile bottom tab bar. Four daily destinations plus an "עוד" sheet = 5 targets
 * (IA §8.1); the sheet holds דוחות + הגדרות וניהול. Reports must stay in the
 * sheet — it is on no other mobile route, so dropping it strands the tab.
 */
const PRIMARY_ITEMS = [PRIMARY_NAV[0], PRIMARY_NAV[1], PRIMARY_NAV[2], PRIMARY_NAV[3]];
const MORE_ITEMS = [PRIMARY_NAV[4], MANAGE_NAV];

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  // A navigation always dismisses the sheet.
  useEffect(() => setMoreOpen(false), [location.pathname]);

  const moreActive = MORE_ITEMS.some((item) => location.pathname.startsWith(item.path));

  return (
    <>
      {moreOpen && (
        <div className="bottom-sheet-overlay" onClick={() => setMoreOpen(false)}>
          <div
            className="bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="עוד מסכים"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bottom-sheet-handle" aria-hidden />
            {MORE_ITEMS.map((item) => (
              <NavLink key={item.path} to={item.path} className="bottom-sheet-item">
                <span aria-hidden>{item.icon}</span> {item.label}
              </NavLink>
            ))}
            <button type="button" className="bottom-sheet-close" onClick={() => setMoreOpen(false)}>
              סגירה
            </button>
          </div>
        </div>
      )}

      <nav className="bottom-nav" aria-label="ניווט תחתון">
        {PRIMARY_ITEMS.map((item) => (
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
        <button
          type="button"
          className={`bottom-nav-item ${moreActive ? "bottom-nav-item-active" : ""}`}
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
        >
          <span className="bottom-nav-icon" aria-hidden>
            ⋯
          </span>
          <span className="bottom-nav-label">עוד</span>
        </button>
      </nav>
    </>
  );
}
