import { MANAGE_NAV, PRIMARY_NAV } from "../../app/navigation";
import { themeBrand, useTheme } from "../../context/ThemeContext";
import { SidebarItem } from "./SidebarItem";

export function Sidebar() {
  const { theme } = useTheme();
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
    </aside>
  );
}
