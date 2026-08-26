import { api, TOKEN_KEY } from "./api";

export type UserRole = "ADMIN" | "USER" | "VIEWER";

/** Who is signed in. Mirrors the backend `Identity` (modules/gate/credentials.ts). */
export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  role: UserRole;
}

const USER_KEY = "gate_user";

export function isLoggedIn(): boolean {
  return localStorage.getItem(TOKEN_KEY) !== null;
}

/**
 * The signed-in user as last known, without a round-trip — so the header can
 * greet by name (and the CRM entry point/routes can gate on role) on first
 * paint. `checkSession` refreshes it from the server.
 */
export function currentUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function storeUser(user: AuthUser | undefined): void {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function login(email: string, password: string): Promise<AuthUser | null> {
  const { data } = await api.post<{ token: string; user?: AuthUser }>("/gate/login", {
    email,
    password,
  });
  localStorage.setItem(TOKEN_KEY, data.token);
  storeUser(data.user);
  return data.user ?? null;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/gate/logout");
  } finally {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

/** Validates the stored token against the server (used on app boot). */
export async function checkSession(): Promise<boolean> {
  if (!isLoggedIn()) return false;
  try {
    const { data } = await api.get<{ authenticated: boolean; user?: AuthUser }>("/gate/session");
    storeUser(data.user);
    return true;
  } catch {
    return false;
  }
}
