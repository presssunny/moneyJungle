import { NAV_ITEMS } from "../../app/navigation";
import { themeBrand, useTheme } from "../../context/ThemeContext";
import { SidebarItem } from "./SidebarItem";

export function Sidebar() {
  const { theme } = useTheme();
  return (
    <aside className="sidebar">
      <div className="sidebar-logo mono">
        <span aria-hidden>💰</span> {themeBrand(theme)}
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <SidebarItem key={item.path} path={item.path} label={item.label} icon={item.icon} />
        ))}
      </nav>
    </aside>
  );
}
