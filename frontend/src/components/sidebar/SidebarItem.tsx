import { NavLink } from "react-router-dom";

interface SidebarItemProps {
  path: string;
  label: string;
  icon: string;
}

export function SidebarItem({ path, label, icon }: SidebarItemProps) {
  return (
    <NavLink
      to={path}
      end={path === "/"}
      className={({ isActive }) => `sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
    >
      <span className="sidebar-item-icon" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
    </NavLink>
  );
}
