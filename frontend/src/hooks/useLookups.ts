import { useEffect, useState } from "react";
import { listCategories, listPaymentMethods } from "../services/planning.service";
import type { Category, PaymentMethod } from "../types/models";

/** Categories + payment methods, loaded once per page. */
export function useLookups() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
    listPaymentMethods().then(setPaymentMethods).catch(() => {});
  }, []);

  const expenseCategories = categories.filter((c) => c.type === "expense");

  return { categories, expenseCategories, paymentMethods };
}
