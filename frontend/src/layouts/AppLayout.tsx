import { Outlet } from "react-router-dom";
import { Header } from "../components/header/Header";
import { Sidebar } from "../components/sidebar/Sidebar";
import { MonthProvider } from "../context/MonthContext";

export function AppLayout() {
  return (
    <MonthProvider>
      <a href="#main-content" className="skip-link">
        דילוג לתוכן הראשי
      </a>
      <div className="layout">
        <Sidebar />
        <div className="layout-main">
          <Header />
          <main className="layout-content" id="main-content" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </MonthProvider>
  );
}
