import { Outlet } from "react-router-dom";
import { Toaster } from "../components/common/Toaster";
import { Header } from "../components/header/Header";
import { BottomNav } from "../components/nav/BottomNav";
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
      <BottomNav />
      <Toaster />
    </MonthProvider>
  );
}
