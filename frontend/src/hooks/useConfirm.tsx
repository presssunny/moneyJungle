import { useCallback, useState } from "react";
import { ConfirmDialog, type ConfirmRequest } from "../components/common/ConfirmDialog";
import { toastApiError } from "../services/api";

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
