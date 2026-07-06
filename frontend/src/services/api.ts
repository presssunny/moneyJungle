import axios from "axios";

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
      if (window.location.pathname !== "/gate") {
        window.location.href = "/gate";
      }
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
