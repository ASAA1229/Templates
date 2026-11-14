import { fieldErrors, loginSchema } from "@asaa/contracts";
import { LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { Field } from "@/components/common";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Owner sign-in (US-A01). Client validation mirrors the server contract. */
export function LoginPage() {
  const { status, signIn, expired } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "", code: "" });
  const [needsCode, setNeedsCode] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  if (status === "signed-in") {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith("/") ? from : "/"} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const parsed = loginSchema.safeParse({ ...form, code: needsCode ? form.code : undefined });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await signIn(parsed.data);
    } catch (error) {
      if (error instanceof ApiError && error.code === "MFA_REQUIRED") setNeedsCode(true);
      setMessage(error instanceof ApiError ? error.message : "Sign-in failed.");
      if (!(error instanceof ApiError && error.code === "MFA_REQUIRED")) {
        setForm((current) => ({ ...current, password: "", code: "" }));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <span
            aria-hidden="true"
            className="mb-2 grid size-10 place-items-center rounded-lg bg-primary text-lg font-bold text-primary-foreground"
          >
            A
          </span>
          <CardTitle>
            <span className="text-xl">Sign in to ASAA Templates</span>
          </CardTitle>
          <CardDescription>Private owner workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={submit} className="space-y-4">
            {expired && !message && <Alert tone="warning">Your session ended. Sign in again to continue.</Alert>}
            {message && <Alert tone="danger">{message}</Alert>}
            <Field label="Email" error={errors.email}>
              <Input
                type="email"
                autoComplete="username"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </Field>
            <Field label="Password" error={errors.password}>
              <Input
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required
              />
            </Field>
            {needsCode && (
              <Field label="Authenticator or recovery code" error={errors.code}>
                <Input
                  autoComplete="one-time-code"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  required
                />
              </Field>
            )}
            <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
              <LogIn aria-hidden="true" /> {pending ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Need an account?{" "}
              <Link className="underline" to="/request-access">
                Request employee access
              </Link>
            </p>
            <p className="text-xs text-muted-foreground">
              Forgot your password? Ask an ASAA owner or administrator for a one-time reset link.
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
