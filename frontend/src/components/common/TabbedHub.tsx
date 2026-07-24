import type { KeyboardEvent, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

export interface HubTab {
  key: string;
  label: string;
  icon: string;
  element: ReactNode;
}

/**
 * A hub page that groups several related screens under one primary destination,
 * switching between them with an in-page tab bar (state kept in ?tab= so tabs are
 * linkable and survive refresh). Only the active tab is mounted, so each screen
 * fetches fresh data when selected — matching how the standalone pages behaved.
 */
export function TabbedHub({ tabs }: { tabs: HubTab[] }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const active = tabs.find((t) => t.key === requested) ?? tabs[0];

  const selectTab = (key: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", key);
        return next;
      },
      { replace: true }
    );

  // Arrow-key navigation between tabs (WAI-ARIA tabs pattern).
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowRight" ? -1 : e.key === "ArrowLeft" ? 1 : 0; // RTL
    if (delta === 0) return;
    e.preventDefault();
    const next = (index + delta + tabs.length) % tabs.length;
    selectTab(tabs[next].key);
  };

  return (
    <div className="hub">
      <div className="hub-tabs" role="tablist">
        {tabs.map((tab, index) => {
          const selected = tab.key === active.key;
          return (
            <button
              key={tab.key}
              id={`hubtab-${tab.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`hubpanel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              className={`hub-tab ${selected ? "hub-tab-active" : ""}`}
              onClick={() => selectTab(tab.key)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              <span aria-hidden>{tab.icon}</span> {tab.label}
            </button>
          );
        })}
      </div>
      <div
        className="hub-panel"
        role="tabpanel"
        id={`hubpanel-${active.key}`}
        aria-labelledby={`hubtab-${active.key}`}
        tabIndex={0}
      >
        {active.element}
      </div>
    </div>
  );
}
