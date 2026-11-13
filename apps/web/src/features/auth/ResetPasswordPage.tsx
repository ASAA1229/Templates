import { passwordSchema } from "@asaa/contracts";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { Field } from "@/components/common";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);

  if (!token) return <Navigate to="/login" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Choose a stronger password.");
      return;
    }
    setPending(true);
    try {
      await api("/auth/password-reset/consume", { method: "POST", body: { token, password } });
      setComplete(true);
      setPassword("");
      setConfirm("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to reset this password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            This one-time link expires after 30 minutes. Resetting your password ends all active sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {complete ? (
            <div className="space-y-4">
              <Alert tone="success">Your password has been changed. All previous sessions have been revoked.</Alert>
              <Link className="block text-center text-sm underline" to="/login">
                Continue to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)} className="space-y-4">
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="New password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field label="Confirm new password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </Field>
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Resetting…" : "Reset password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
