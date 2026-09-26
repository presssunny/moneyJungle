import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Modal } from "./Modal";
import { QuickAddBar } from "./QuickAddBar";

// Home and the transactions screen already show the quick-add field inline.
const INLINE = new Set(["/", "/transactions", "/onboarding"]);

/** Phone-only: one thumb-reach button that records an expense from any screen. */
export function QuickAddFab() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  if (INLINE.has(pathname)) return null;
  return (
    <>
      <button type="button" className="quick-add-fab" aria-label="הוספת הוצאה מהירה" onClick={() => setOpen(true)}>+</button>
      <Modal title="הוספת הוצאה מהירה" open={open} onClose={() => setOpen(false)}>
        <QuickAddBar />
      </Modal>
    </>
  );
}
