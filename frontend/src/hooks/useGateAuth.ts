import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiErrorMessage } from "../services/api";
import * as gateService from "../services/gate.service";

export function useGateAuth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(username: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      await gateService.login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "שם המשתמש או הסיסמה שגויים"));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await gateService.logout();
    navigate("/login", { replace: true });
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
