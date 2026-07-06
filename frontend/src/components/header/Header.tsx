import { useLocation } from "react-router-dom";
import { NAV_ITEMS } from "../../app/navigation";
import { useGateAuth } from "../../hooks/useGateAuth";
import { MonthSelector } from "./MonthSelector";

export function Header() {
  const location = useLocation();
  const { logout } = useGateAuth();
  const current = NAV_ITEMS.find((item) =>
    item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path)
  );

  return (
    <header className="header">
      <h1 className="header-title">
        <span aria-hidden>{current?.icon}</span> {current?.label ?? ""}
      </h1>
      <div className="header-actions">
        <MonthSelector />
        <button className="header-logout" onClick={logout} title="יציאה">
          יציאה ⎋
        </button>
      </div>
    </header>
  );
}
