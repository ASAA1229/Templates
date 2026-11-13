import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Member = {
  id: string;
  role: "VIEWER" | "EDITOR";
  createdAt: string;
  member: { id: string; email: string; displayName: string; role: string; isActive: boolean };
};

export function ProjectMembersPanel({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"VIEWER" | "EDITOR">("VIEWER");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const result = await api<{ members: Member[] }>(`/projects/${projectId}/members`);
      setMembers(result.members);
      setVisible(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setVisible(false);
      else setError(cause instanceof ApiError ? cause.message : "Unable to load project members.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  async function addMember(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/projects/${projectId}/members`, { method: "POST", body: { email, role } });
      setEmail("");
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to share this project.");
    } finally { setBusy(false); }
  }

  async function remove(memberId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/projects/${projectId}/members/${memberId}`, { method: "DELETE" });
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to revoke project access.");
    } finally { setBusy(false); }
  }

  if (loading || !visible) return null;

  return (
    <Card className="h-fit">
      <CardHeader><CardTitle>Project access</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Share this project with active ASAA team members. Viewers can read; editors can change project content.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <form onSubmit={(event) => void addMember(event)} className="space-y-2">
          <Input type="email" required maxLength={254} placeholder="team.member@asaa.com" value={email} onChange={(event) => setEmail(event.target.value)} aria-label="Team member email" />
          <Select value={role} onChange={(event) => setRole(event.target.value as "VIEWER" | "EDITOR")} aria-label="Project access role">
            <option value="VIEWER">Viewer</option>
            <option value="EDITOR">Editor</option>
          </Select>
          <Button type="submit" size="sm" disabled={busy || !email.trim()} className="w-full">Share project</Button>
        </form>
        <div className="space-y-2">
          {members.length === 0 ? <p className="text-sm text-muted-foreground">No team members have access yet.</p> : members.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.member.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{item.member.email} · {item.role.toLowerCase()}</p>
              </div>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(item.member.id)} aria-label={`Remove ${item.member.email}`}>Remove</Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
