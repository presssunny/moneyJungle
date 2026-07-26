import { useEffect, useState } from "react";
import { listCategories, listPaymentMethods } from "../services/planning.service";
import type { Category, PaymentMethod } from "../types/models";

/** Categories + payment methods, loaded once per page. */
export function useLookups() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  useEffect(() => {
    // Deliberately silent: these only populate <select> options. A failure leaves
    // the dropdowns empty and is already reported by the global toast in api.ts;
    // an error panel per dropdown would drown the widget errors that matter.
    listCategories().then(setCategories).catch(() => {});
    listPaymentMethods().then(setPaymentMethods).catch(() => {});
  }, []);

  const expenseCategories = categories.filter((c) => c.type === "expense");

  return { categories, expenseCategories, paymentMethods };
}
