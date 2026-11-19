import { ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorState, Field, LoadingState } from "@/components/common";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";

interface MfaStatus {
  mfa: {
    available: boolean;
    enabled: boolean;
    pendingEnrollment: boolean;
    recoveryCodesRemaining: number;
    requiredForPrivileged: boolean;
  };
}

/** Authenticator-app (TOTP) enrolment with one-time recovery codes (US-A04). */
export function MfaPanel() {
  const status = useResource<MfaStatus>("/auth/mfa");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
      status.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const enroll = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      setSetup(await api("/auth/mfa/enroll", { method: "POST", body: { password } }));
      setPassword("");
    });
  };
  const activate = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await api<{ recoveryCodes: string[] }>("/auth/mfa/activate", { method: "POST", body: { code } });
      setRecovery(result.recoveryCodes);
      setSetup(null);
      setCode("");
    });
  };
  const disable = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api("/auth/mfa/disable", { method: "POST", body: { password, code } });
      setPassword("");
      setCode("");
      setRecovery(null);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Multi-factor authentication</CardTitle>
        <CardDescription>Protect your account with a code from an authenticator app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.state === "loading" && <LoadingState label="Loading…" />}
        {status.state === "error" && <ErrorState error={status.error} onRetry={status.reload} />}
        {error && <Alert tone="danger">{error}</Alert>}
        {recovery && (
          <Alert tone="warning">
            Save these recovery codes now; each works once and they are not shown again:
            <ul aria-label="Recovery codes" className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
              {recovery.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Alert>
        )}
        {status.state === "ready" && !status.data.mfa.available && (
          <Alert tone="info">Multi-factor authentication is not configured on this server.</Alert>
        )}
        {status.state === "ready" && status.data.mfa.available && !status.data.mfa.enabled && !setup && (
          <form onSubmit={enroll} className="space-y-3" aria-label="Start MFA enrolment">
            <Field label="Confirm your password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" disabled={busy}>
              <ShieldCheck aria-hidden="true" /> Set up authenticator
            </Button>
          </form>
        )}
        {setup && (
          <form onSubmit={activate} className="space-y-3" aria-label="Confirm MFA enrolment">
            <p className="text-sm">
              Add this key to your authenticator app, then enter the 6-digit code. Key:{" "}
              <code className="font-mono">{setup.secret}</code>
            </p>
            <Field label="6-digit code">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" disabled={busy}>
              Turn on MFA
            </Button>
          </form>
        )}
        {status.state === "ready" && status.data.mfa.enabled && (
          <form onSubmit={disable} className="space-y-3" aria-label="Turn off MFA">
            <p className="text-sm">MFA is on. {status.data.mfa.recoveryCodesRemaining} recovery codes remain.</p>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Field label="Authenticator or recovery code">
              <Input autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            </Field>
            <Button type="submit" variant="outline" disabled={busy}>
              Turn off MFA
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
