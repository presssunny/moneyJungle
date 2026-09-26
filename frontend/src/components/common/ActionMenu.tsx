import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  tone?: "danger";
}

/** A row's secondary actions behind one "⋯" button (WAI-ARIA menu button), so a narrow card keeps one target instead of three. */
export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }
  function onMenuKey(e: KeyboardEvent, index: number) {
    const move = (to: number) => { e.preventDefault(); itemRefs.current[(to + items.length) % items.length]?.focus(); };
    if (e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowUp") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") close();
  }

  return (
    <div className="action-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
      >
        ⋯
      </button>
      {open && (
        <ul className="action-menu-list" role="menu" id={menuId} aria-label={label}>
          {items.map((item, index) => (
            <li key={item.label} role="none">
              <button
                ref={(el) => { itemRefs.current[index] = el; }}
                type="button"
                role="menuitem"
                className={`action-menu-item ${item.tone === "danger" ? "action-menu-item-danger" : ""}`}
                onKeyDown={(e) => onMenuKey(e, index)}
                onClick={() => { setOpen(false); item.onSelect(); }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
