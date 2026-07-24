import { useEffect, useState } from "react";
import { subscribeToasts, type ToastItem } from "../../services/toast";

const ICONS: Record<ToastItem["kind"], string> = {
  error: "⚠️",
  success: "✅",
  info: "ℹ️",
};

/** Renders transient toast messages published on the global toast bus. */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(
    () =>
      subscribeToasts((item) => {
        setItems((prev) => [...prev, item]);
        window.setTimeout(
          () => setItems((prev) => prev.filter((i) => i.id !== item.id)),
          5000
        );
      }),
    []
  );

  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          className={`toast toast-${item.kind}`}
          onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
        >
          <span aria-hidden>{ICONS[item.kind]}</span>
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
