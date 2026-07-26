import { Outlet } from "react-router-dom";
import { Toaster } from "../components/common/Toaster";
import { FilterBar } from "../components/filters/FilterBar";
import { Header } from "../components/header/Header";
import { BottomNav } from "../components/nav/BottomNav";
import { Sidebar } from "../components/sidebar/Sidebar";
import { FiltersProvider } from "../context/FiltersContext";

export function AppLayout() {
  return (
    <FiltersProvider>
      <a href="#main-content" className="skip-link">
        דילוג לתוכן הראשי
      </a>
      <div className="layout">
        <Sidebar />
        <div className="layout-main">
          {/* Header + filters stick together, so the filter strip never overlaps
              the title and the content below it always has a known offset. */}
          <div className="layout-topbar">
            <Header />
            <FilterBar />
          </div>
          <main className="layout-content" id="main-content" tabIndex={-1} aria-live="polite">
            <Outlet />
          </main>
        </div>
      </div>
      <BottomNav />
      <Toaster />
    </FiltersProvider>
  );
}
