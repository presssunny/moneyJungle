import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiErrorMessage, toastApiError } from "../services/api";
import * as gateService from "../services/gate.service";

export function useGateAuth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(email: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      await gateService.login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "האימייל או הסיסמה שגויים"));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await gateService.logout();
      navigate("/login", { replace: true });
    } catch (err) { toastApiError(err, "היציאה לא הושלמה. נסי שוב."); }
  }

  return {
    login,
    logout,
    loading,
    error,
    isLoggedIn: gateService.isLoggedIn,
    currentUser: gateService.currentUser,
  };
}
