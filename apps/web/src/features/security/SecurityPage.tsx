import { changePasswordSchema, fieldErrors, type SessionView } from "@asaa/contracts";
import { KeyRound, LogOut, MonitorSmartphone } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorState, Field, LoadingState, PageHeader } from "@/components/common";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { formatDateTime } from "@/lib/utils";
import { MfaPanel } from "./MfaPanel";

/** Session management and password change (US-A02). */
export function SecurityPage() {
  const sessions = useResource<{ sessions: SessionView[] }>("/auth/sessions");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function act(action: () => Promise<unknown>, success: string) {
    setNotice("");
    setError("");
    try {
      await action();
      setNotice(success);
      sessions.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Action failed.");
    }
  }

  return (
    <>
      <PageHeader
        title="Security"
        description="Active sessions and password."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Security" }]}
      />
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Sessions expire after inactivity and after a fixed maximum lifetime.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessions.state === "loading" && <LoadingState label="Loading sessions" rows={2} />}
            {sessions.state === "error" && <ErrorState error={sessions.error} onRetry={sessions.reload} />}
            {sessions.state === "ready" && (
              <>
                <ul className="space-y-2">
                  {sessions.data.sessions.map((session) => (
                    <li
                      key={session.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                    >
                      <span className="flex min-w-0 items-start gap-2">
                        <MonitorSmartphone aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate">{session.userAgent ?? "Unknown device"}</span>
                          <span className="text-xs text-muted-foreground">
                            Last active {formatDateTime(session.lastSeenAt)} · expires{" "}
                            {formatDateTime(session.expiresAt)}
                          </span>
                        </span>
                      </span>
                      {session.current ? (
                        <Badge tone="success">This session</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void act(
                              () => api(`/auth/sessions/${session.id}/revoke`, { method: "POST" }),
                              "Session revoked.",
                            )
                          }
                        >
                          Revoke
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {sessions.data.sessions.length > 1 && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void act(
                        () => api("/auth/sessions/revoke-others", { method: "POST" }),
                        "Other sessions signed out.",
                      )
                    }
                  >
                    <LogOut aria-hidden="true" /> Sign out all other sessions
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <MfaPanel />
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>All other sessions are signed out after a change.</CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordForm onChanged={() => setNotice("Password changed. Other sessions were signed out.")} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = changePasswordSchema.safeParse(form);
    const next = parsed.success ? {} : fieldErrors(parsed.error);
    if (form.confirm !== form.newPassword) next.confirm = "Passwords do not match.";
    if (Object.keys(next).length || !parsed.success) return setErrors(next);
    setErrors({});
    setPending(true);
    try {
      await api("/auth/password", { method: "POST", body: parsed.data });
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      onChanged();
    } catch (error) {
      setErrors(
        error instanceof ApiError
          ? { ...error.fields, ...(Object.keys(error.fields).length ? {} : { _: error.message }) }
          : { _: "Could not change the password." },
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4" aria-label="Change password">
      {errors._ && <Alert tone="danger">{errors._}</Alert>}
      <Field label="Current password" error={errors.currentPassword}>
        <Input
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
        />
      </Field>
      <Field label="New password" hint="At least 12 characters." error={errors.newPassword}>
        <Input
          type="password"
          autoComplete="new-password"
          value={form.newPassword}
          onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
        />
      </Field>
      <Field label="Confirm new password" error={errors.confirm}>
        <Input
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(event) => setForm({ ...form, confirm: event.target.value })}
        />
      </Field>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        <KeyRound aria-hidden="true" /> {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
