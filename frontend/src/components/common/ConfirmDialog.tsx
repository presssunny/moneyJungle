import { useCallback, useState, type ReactNode } from "react";
import { toastApiError } from "../../services/api";
import { Button } from "./Button";
import { Modal } from "./Modal";

/**
 * Replacement for `window.confirm`, which cannot be styled and has no room to say
 * what is about to be lost — a destructive action states its consequence (IA §7).
 * Built on `Modal`, so focus trap, Escape and scroll lock come for free.
 */

export interface ConfirmRequest {
  title: string;
  /** What will happen, in plain Hebrew. Shown under the title. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the confirm button red — use for anything irreversible. */
  tone?: "danger" | "default";
}

interface ConfirmDialogProps extends ConfirmRequest {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the confirmed action is running, to block a double submit. */
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "אישור",
  cancelLabel = "ביטול",
  tone = "default",
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} open={open} onClose={onCancel}>
      <div className="confirm-body">{message}</div>
      <div className="modal-actions">
        {/* Cancel comes first so the safe choice is the one under the thumb. */}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={tone === "danger" ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "רגע..." : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

interface PendingConfirm extends ConfirmRequest {
  action: () => void | Promise<void>;
}

/**
 * Ask, then act, without every page hand-rolling its dialog state:
 *
 *   confirm.ask({ title, message, tone: "danger" }, () => remove(id));
 *
 * `action` needs no try/catch — a failure is toasted here and the dialog closes
 * either way, since a modal left open would hide the error.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback((request: ConfirmRequest, action: () => void | Promise<void>) => {
    setPending({ ...request, action });
  }, []);

  const cancel = useCallback(() => setPending(null), []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.action();
    } catch (err) {
      toastApiError(err);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }, [pending]);

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ""}
      message={pending?.message ?? ""}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      tone={pending?.tone}
      onConfirm={confirm}
      onCancel={cancel}
      busy={busy}
    />
  );

  return { ask, dialog };
}
