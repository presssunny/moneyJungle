import { useSearchParams } from "react-router-dom";
export function useTransactionFilters() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  });
  const clear = () => setParams(previous => {
    const next = new URLSearchParams(previous);
    for (const key of ["q", "category", "uncat", "recurring", "type", "from", "to"]) next.delete(key);
    return next;
  });
  return { params, set, clear };
}
