export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  role: "ADMIN" | "USER" | "VIEWER";
}

let user: AuthUser | null = null;
let csrfToken: string | null = null;

export function sessionUser() { return user; }
export function sessionCsrf() { return csrfToken; }
export function setSession(identity: AuthUser, csrf: string) {
  user = identity;
  csrfToken = csrf;
}
export function clearSession() {
  user = null;
  csrfToken = null;
  try {
    localStorage.removeItem("gate_token");
    localStorage.removeItem("gate_user");
    localStorage.removeItem("mj_onboarded");
  } catch { /* Authentication does not require browser storage. */ }
}
