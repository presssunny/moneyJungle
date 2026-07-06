import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiErrorMessage } from "../services/api";
import * as gateService from "../services/gate.service";

export function useGateAuth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(password: string) {
    setLoading(true);
    setError(null);
    try {
      await gateService.login(password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "סיסמה שגויה"));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await gateService.logout();
    navigate("/gate", { replace: true });
  }

  return { login, logout, loading, error, isLoggedIn: gateService.isLoggedIn };
}
