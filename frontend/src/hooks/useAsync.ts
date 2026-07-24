import { useCallback, useEffect, useRef, useState, type DependencyList, type Dispatch, type SetStateAction } from "react";
import { apiErrorMessage } from "../services/api";

export interface AsyncResource<T> {
  /** Last successfully loaded value, or null while it has never loaded. */
  data: T | null;
  /** Hebrew message to show the user; null when the last load succeeded. */
  error: string | null;
  loading: boolean;
  /** Re-run the loader (wired to the "נסי שוב" button of every widget). */
  reload: () => void;
  /** Patch the loaded value locally after a mutation, without a round-trip. */
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * One loader = one widget = three explicit states (loading / error / data).
 *
 * Replaces the `fetch().then(setState).catch(() => {})` pattern that swallowed
 * network failures and left widgets stuck on a spinner forever — the root of
 * "אי אפשר לראות שום דבר" (IA §1.3). A failure here is *visible* and *retryable*
 * per widget, so one dead endpoint never takes the whole page down.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: DependencyList,
  errorMessage = "לא הצלחנו לטעון את הנתונים"
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  // Keep the latest loader without making it a dependency (callers pass inline arrows).
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const messageRef = useRef(errorMessage);
  messageRef.current = errorMessage;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loaderRef.current()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(apiErrorMessage(err, messageRef.current));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { data, error, loading, reload, setData };
}
