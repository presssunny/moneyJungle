import { Outlet } from "react-router-dom";
import { Header } from "../components/header/Header";
import { Sidebar } from "../components/sidebar/Sidebar";
import { MonthProvider } from "../context/MonthContext";

export function AppLayout() {
  return (
    <MonthProvider>
      <div className="layout">
        <Sidebar />
        <div className="layout-main">
          <Header />
          <main className="layout-content">
            <Outlet />
          </main>
        </div>
      </div>
    </MonthProvider>
  );
}
