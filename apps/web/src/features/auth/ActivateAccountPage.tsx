import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { Field } from "@/components/common";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";

export function ActivateAccountPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [activated, setActivated] = useState(false);

  if (!token) return <Navigate to="/request-access" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      await api("/auth/access-requests/activate", {
        method: "POST",
        body: { token, password },
      });
      setActivated(true);
      setMessage("Your account is active. You can now sign in.");
      setPassword("");
      setConfirm("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to activate this account.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Activate your account</CardTitle>
          <CardDescription>
            Choose a strong password to finish setting up your employee account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            {message && <Alert tone="success">{message}</Alert>}
            {error && <Alert tone="danger">{error}</Alert>}
            {!activated && (
              <>
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
                <Field label="Confirm password">
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
                  {pending ? "Activating…" : "Activate account"}
                </Button>
              </>
            )}
            {activated && (
              <Link className="block text-center text-sm underline" to="/login">
                Go to sign in
              </Link>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
