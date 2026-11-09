import type { LoginInput, OwnerView } from "@asaa/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, onUnauthenticated } from "./api";

interface AuthState {
  status: "checking" | "signed-out" | "signed-in";
  owner: OwnerView | null;
  signIn(input: LoginInput): Promise<void>;
  signOut(): Promise<void>;
  /** Called after the server ended this session (expiry, revocation, password change). */
  expired: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<OwnerView | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("checking");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    api<{ owner: OwnerView }>("/auth/session")
      .then(({ owner: current }) => {
        setOwner(current);
        setStatus("signed-in");
      })
      .catch(() => setStatus("signed-out"));
  }, []);

  useEffect(
    () =>
      onUnauthenticated(() => {
        setOwner((current) => {
          if (current) setExpired(true);
          return null;
        });
        setStatus("signed-out");
      }),
    [],
  );

  const signIn = useCallback(async (input: LoginInput) => {
    const result = await api<{ owner: OwnerView }>("/auth/login", { method: "POST", body: input });
    setExpired(false);
    setOwner(result.owner);
    setStatus("signed-in");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    setOwner(null);
    setStatus("signed-out");
  }, []);

  const value = useMemo(() => ({ status, owner, signIn, signOut, expired }), [status, owner, signIn, signOut, expired]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
