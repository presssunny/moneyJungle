import axios from "axios";
import { api } from "./api";
import { clearSession, sessionUser, setSession, type AuthUser } from "./sessionState";

export type { AuthUser } from "./sessionState";
export type UserRole = AuthUser["role"];

export function isLoggedIn(): boolean { return sessionUser() !== null; }
export function currentUser(): AuthUser | null { return sessionUser(); }

export async function login(email: string, password: string): Promise<AuthUser> {
  const { data } = await api.post<{ user: AuthUser; csrfToken: string }>("/gate/login", { email, password });
  clearSession();
  setSession(data.user, data.csrfToken);
  return data.user;
}

export async function logout(): Promise<void> {
  await api.post("/gate/logout");
  clearSession();
}

let checking: Promise<boolean> | null = null;
export function checkSession(): Promise<boolean> {
  if (checking) return checking;
  clearSession();
  checking = api.get<{ user: AuthUser; csrfToken: string }>("/gate/session")
    .then(({ data }) => { setSession(data.user, data.csrfToken); return true; })
    .catch((error: unknown) => {
      if (axios.isAxiosError(error) && error.response?.status === 401) return false;
      throw error;
    })
    .finally(() => { checking = null; });
  return checking;
}
