import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiHooks, getToken, setToken, type ApiDetail } from "./api";
import type { Me, MfaChallenge, TokenResponse } from "./types";

export interface RevokedBanner {
  code: string;
  reason: string;
  by?: string;
  at: string;
}

interface AuthState {
  token: string | null;
  me: Me | undefined;
  meLoading: boolean;
  banner: RevokedBanner | null;
  dismissBanner: () => void;
  login: (username: string, password: string) => Promise<{ challenge?: string }>;
  verifyMfa: (challenge: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);
const BANNER_KEY = "staydesk.revoked_banner";

function readBanner(): RevokedBanner | null {
  try {
    return JSON.parse(sessionStorage.getItem(BANNER_KEY) || "null");
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [token, setTok] = useState<string | null>(getToken());
  const [banner, setBanner] = useState<RevokedBanner | null>(readBanner);

  const clearSession = useCallback(() => {
    setToken(null);
    setTok(null);
    qc.clear();
  }, [qc]);

  const dismissBanner = useCallback(() => {
    sessionStorage.removeItem(BANNER_KEY);
    setBanner(null);
  }, []);

  useEffect(() => {
    apiHooks.onUnauthorized = (detail: ApiDetail | null) => {
      const code = detail?.code;
      if (code === "session_revoked" || code === "account_suspended") {
        const b: RevokedBanner = {
          code,
          reason:
            (detail?.revoked_reason as string | undefined) ||
            (code === "account_suspended" ? "Account suspended" : detail?.reason) ||
            "Session revoked",
          by: (detail?.revoked_by as string | undefined) || undefined,
          at: new Date().toISOString(),
        };
        sessionStorage.setItem(BANNER_KEY, JSON.stringify(b));
        setBanner(b);
      }
      clearSession();
      navigate("/login", { replace: true });
    };
    return () => {
      apiHooks.onUnauthorized = undefined;
    };
  }, [clearSession, navigate]);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/auth/me"),
    enabled: !!token,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    retry: false,
    meta: { silent: true },
  });

  const complete = useCallback(
    async (resp: TokenResponse) => {
      setToken(resp.access_token);
      setTok(resp.access_token);
      dismissBanner();
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    [qc, dismissBanner],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const resp = await api<TokenResponse | MfaChallenge>("/auth/login", {
        method: "POST",
        body: { username, password },
        auth: "none",
      });
      if ("mfa_required" in resp && resp.mfa_required) return { challenge: resp.challenge_token };
      await complete(resp as TokenResponse);
      return {};
    },
    [complete],
  );

  const verifyMfa = useCallback(
    async (challenge: string, code: string) => {
      const resp = await api<TokenResponse>("/auth/mfa", {
        method: "POST",
        body: { challenge_token: challenge, code },
        auth: "none",
      });
      await complete(resp);
    },
    [complete],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* session may already be gone */
    }
    clearSession();
    navigate("/login", { replace: true });
  }, [clearSession, navigate]);

  const value = useMemo<AuthState>(
    () => ({
      token,
      me: meQuery.data,
      meLoading: meQuery.isLoading,
      banner,
      dismissBanner,
      login,
      verifyMfa,
      logout,
      can: (perm: string) => meQuery.data?.staff.permissions.includes(perm) ?? false,
    }),
    [token, meQuery.data, meQuery.isLoading, banner, dismissBanner, login, verifyMfa, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
