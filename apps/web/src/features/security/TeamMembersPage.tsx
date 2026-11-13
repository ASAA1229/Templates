import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { EmptyState, LoadingState, PageHeader } from "@/components/common";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Role = "ADMIN" | "DEVELOPER" | "TESTER" | "EMPLOYEE";
type Member = {
  id: string;
  email: string;
  displayName: string;
  role: Role | "OWNER";
  isActive: boolean;
  createdAt: string;
};

export function TeamMembersPage() {
  const { owner } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resetLink, setResetLink] = useState<{ email: string; url: string; expiresAt: string } | null>(null);
  const [resettingMemberId, setResettingMemberId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ members: Member[] }>("/auth/members");
      setMembers(result.members);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load team members.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/auth/members", {
        method: "POST",
        body: {
          email: values.get("email"),
          displayName: values.get("displayName"),
          role: values.get("role"),
          password: values.get("password"),
        },
      });
      form.reset();
      setMessage(
        "Member account created. Share the initial password securely; the member can change it after signing in.",
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to create member account.");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(member: Member) {
    setError("");
    try {
      await api(`/auth/members/${member.id}/active`, { method: "PATCH", body: { isActive: !member.isActive } });
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to update account status.");
    }
  }

  async function issuePasswordReset(member: Member) {
    setError("");
    setMessage("");
    setResettingMemberId(member.id);
    try {
      const result = await api<{ resetUrl: string; expiresAt: string }>("/auth/password-reset/issue", {
        method: "POST",
        body: { email: member.email },
      });
      setResetLink({ email: member.email, url: result.resetUrl, expiresAt: result.expiresAt });
      setMessage("A one-time password reset link has been issued. Share it with the employee through a secure channel.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to issue a password reset link.");
    } finally {
      setResettingMemberId(null);
    }
  }
  if (owner?.role !== "OWNER" && owner?.role !== "ADMIN") {
    return (
      <EmptyState title="Access restricted" description="Only owners and administrators can manage team accounts." />
    );
  }

  return (
    <>
      <PageHeader
        title="Team members"
        description="Create employee accounts, assign least-privilege roles and revoke access when needed."
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Create member account</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void createMember(event)}>
            <label className="space-y-1 text-sm">
              Full name
              <input
                required
                name="displayName"
                maxLength={120}
                className="w-full rounded-md border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              Work email
              <input
                required
                name="email"
                type="email"
                maxLength={254}
                className="w-full rounded-md border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              Role
              <select name="role" defaultValue="EMPLOYEE" className="w-full rounded-md border bg-background px-3 py-2">
                <option value="EMPLOYEE">Employee</option>
                <option value="DEVELOPER">Developer</option>
                <option value="TESTER">Tester</option>
                <option value="ADMIN">Administrator (owner only)</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Initial password
              <input
                required
                name="password"
                type="password"
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                className="w-full rounded-md border bg-background px-3 py-2"
              />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create account"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Accounts</h2>
        {loading ? (
          <LoadingState label="Loading team members" rows={3} />
        ) : members.length === 0 ? (
          <EmptyState title="No members" description="Create the first team account above." />
        ) : (
          members.map((member) => (
            <Card key={member.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium">{member.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    {member.email} · {member.role}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm">{member.isActive ? "Active" : "Deactivated"}</span>
                  {member.role !== "OWNER" && (
                    <Button size="sm" variant="outline" onClick={() => void setActive(member)}>
                      {member.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </>
  );
}
