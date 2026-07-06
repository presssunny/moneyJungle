import { NAV_ITEMS } from "../../app/navigation";
import { SidebarItem } from "./SidebarItem";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo mono">
        <span aria-hidden>💰</span> CYBER_BUDGET
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <SidebarItem key={item.path} path={item.path} label={item.label} icon={item.icon} />
        ))}
      </nav>
    </aside>
  );
}
