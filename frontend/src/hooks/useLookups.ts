import { useCallback, useEffect, useState } from "react";
import { listCategories, listPaymentMethods } from "../services/planning.service";
import type { Category, PaymentMethod } from "../types/models";

/**
 * Categories + payment methods, loaded once per page. A failure does not take the
 * page down — these only fill `<select>` options — but it must SAY so via
 * `failed`: an empty dropdown that looks fine is worse than an error.
 */
export function useLookups() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    Promise.all([listCategories(), listPaymentMethods()])
      .then(([cats, methods]) => {
        if (!alive) return;
        setCategories(cats);
        setPaymentMethods(methods);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const expenseCategories = categories.filter((c) => c.type === "expense");

  return { categories, expenseCategories, paymentMethods, failed, reload };
}
