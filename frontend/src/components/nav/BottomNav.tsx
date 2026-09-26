import { Icon } from "../common/Icon";
import { Modal } from "../common/Modal";
import { useState } from "react";
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
  const location = useLocation();
  // The sheet belongs to the screen it was opened on, so any navigation dismisses it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const moreOpen = openedOn === location.pathname;
  const setMoreOpen = (open: boolean) => setOpenedOn(open ? location.pathname : null);

  const moreActive = MORE_ITEMS.some((item) => location.pathname.startsWith(item.path));

  return (
    <>
      <Modal open={moreOpen} title="עוד מסכים" onClose={() => setMoreOpen(false)}>
        {MORE_ITEMS.map(item => <NavLink key={item.path} to={item.path} className="bottom-sheet-item"><Icon name={item.icon}/>{item.label}</NavLink>)}
      </Modal>

      <nav className="bottom-nav" aria-label="ניווט תחתון">
        {PRIMARY_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item-active" : ""}`}
          >
            <span className="bottom-nav-icon" aria-hidden>
              <Icon name={item.icon}/>
            </span>
            <span className="bottom-nav-label">{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`bottom-nav-item ${moreActive ? "bottom-nav-item-active" : ""}`}
          onClick={() => setMoreOpen(!moreOpen)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
        >
          <span className="bottom-nav-icon" aria-hidden>
            <Icon name="more"/>
          </span>
          <span className="bottom-nav-label">עוד</span>
        </button>
      </nav>
    </>
  );
}
