import axios from "axios";
import { toast } from "./toast";

export const TOKEN_KEY = "gate_token";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:3000/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url: string = error.config?.url ?? "";
    if (status === 401 && !url.includes("/gate/login")) {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    // Surface the failures pages otherwise swallow (a page shows an empty list on
    // load error; a delete rejects with no UI). Validation (4xx) is left to the
    // inline form messages, and gate screens handle their own errors, to avoid
    // double-reporting. Network drops and server (5xx) faults get a global toast.
    const isGate = url.includes("/gate/");
    const isServerFault = !error.response || (typeof status === "number" && status >= 500);
    if (isServerFault && !isGate) {
      toast.error(error.response ? "שגיאת שרת — חלק מהנתונים אולי לא נטענו" : "אין חיבור לשרת");
    }
    return Promise.reject(error);
  }
);

/** Extract a display message from an API error response. */
export function apiErrorMessage(error: unknown, fallback = "אירעה שגיאה, נסה שוב"): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error?.message;
    if (typeof message === "string") return message;
    if (!error.response) return "אין חיבור לשרת";
  }
  return fallback;
}
