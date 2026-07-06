import { api, TOKEN_KEY } from "./api";

export function isLoggedIn(): boolean {
  return localStorage.getItem(TOKEN_KEY) !== null;
}

export async function login(password: string): Promise<void> {
  const { data } = await api.post<{ token: string }>("/gate/login", { password });
  localStorage.setItem(TOKEN_KEY, data.token);
}

export async function logout(): Promise<void> {
  try {
    await api.post("/gate/logout");
  } finally {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/** Validates the stored token against the server (used on app boot). */
export async function checkSession(): Promise<boolean> {
  if (!isLoggedIn()) return false;
  try {
    await api.get("/gate/session");
    return true;
  } catch {
    return false;
  }
}
