import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type React from "react";

export type AuthState = {
  token: string | null;
};

type AuthContextValue = {
  token: string | null;
  isAuthed: boolean;
  setToken: (token: string | null) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const UNAUTHORIZED_EVENT = "auth:unauthorized";

export function AuthProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem("farm_token"));

  const setToken = useCallback((next: string | null) => {
    setTokenState(next);
    if (next) localStorage.setItem("farm_token", next);
    else localStorage.removeItem("farm_token");
  }, []);

  const logout = useCallback(() => setToken(null), [setToken]);

  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isAuthed: Boolean(token),
      setToken,
      logout,
    }),
    [logout, setToken, token]
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
