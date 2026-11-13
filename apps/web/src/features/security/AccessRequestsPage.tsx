import { useCallback, useEffect, useState } from "react";
import { EmptyState, LoadingState, PageHeader } from "@/components/common";
import { Alert, Button, Card, CardContent } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type AccessRequest = { id: string; email: string; displayName: string; reason: string; createdAt: string };

export function AccessRequestsPage() {
  const [items, setItems] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activationUrl, setActivationUrl] = useState("");
  const [busyId, setBusyId] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems((await api<{ requests: AccessRequest[] }>("/auth/access-requests")).requests); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Unable to load access requests."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function review(item: AccessRequest, action: "approve" | "reject") {
    setBusyId(item.id);
    setError("");
    setActivationUrl("");
    try {
      if (action === "approve") {
        const result = await api<{ activationUrl: string; expiresAt: string }>(`/auth/access-requests/${item.id}/approve`, { method: "POST", body: { role: "EMPLOYEE" } });
        setActivationUrl(result.activationUrl);
      } else {
        await api(`/auth/access-requests/${item.id}/reject`, { method: "POST" });
      }
      await reload();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Unable to review this request."); }
    finally { setBusyId(""); }
  }

  return <>
    <PageHeader title="Access requests" description="Review employee requests. Approved requests receive a one-time activation link valid for 24 hours." />
    {error && <Alert tone="danger">{error}</Alert>}
    {activationUrl && <Alert tone="success"><div className="space-y-2"><p>Activation link created. Share it securely with the requester; it is shown only once.</p><div className="break-all font-mono text-xs">{activationUrl}</div><Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(activationUrl)}>Copy activation link</Button></div></Alert>}
    {loading ? <LoadingState label="Loading access requests" rows={3} /> : items.length === 0 ? <EmptyState title="No pending requests" description="New employee access requests will appear here." /> : <section className="space-y-3">{items.map((item) => <Card key={item.id}><CardContent className="flex flex-wrap items-start justify-between gap-4 py-4"><div className="min-w-0"><p className="font-medium">{item.displayName}</p><p className="text-sm text-muted-foreground">{item.email} · {new Date(item.createdAt).toLocaleString()}</p>{item.reason && <p className="mt-2 text-sm">{item.reason}</p>}</div><div className="flex gap-2"><Button size="sm" disabled={!!busyId} onClick={() => void review(item, "approve")}>{busyId === item.id ? "Working…" : "Approve"}</Button><Button size="sm" variant="outline" disabled={!!busyId} onClick={() => void review(item, "reject")}>Reject</Button></div></CardContent></Card>)}</section>}
  </>;
}
