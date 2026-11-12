import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/common";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

type Submission = {
  id: string;
  createdAt: string;
  actorId: string;
  projectKey?: string;
  templateId?: string;
  version?: string;
  title?: string;
  fileCount?: number;
  bytes?: number;
  status: "PENDING_REVIEW" | "APPROVED";
};

export function TemplateSubmissionsPage() {
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ submissions: Submission[] }>("/projects/template-submissions");
      setItems(result.submissions);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not load submissions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  async function approve(id: string) {
    setBusyId(id);
    setError("");
    try {
      await api(`/projects/template-submissions/${id}/approve`, { method: "POST" });
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Approval failed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <PageHeader title="Template submissions" description="Review project contributions before they become reusable library templates." />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {loading ? <LoadingState label="Loading template submissions" rows={3} /> : items.length === 0 ? (
        <EmptyState title="No submissions yet" description="Eligible project contributions will appear here for review." />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>{item.title || item.templateId || "Template candidate"}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{item.templateId} · v{item.version} · project {item.projectKey}</p>
                </div>
                <span className="rounded-full border px-2 py-1 text-xs">{item.status === "APPROVED" ? "Approved" : "Pending review"}</span>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">{item.fileCount ?? "—"} files · submitted {formatDateTime(item.createdAt)}</p>
                {item.status === "PENDING_REVIEW" && (
                  <Button disabled={busyId === item.id} onClick={() => void approve(item.id)}>
                    {busyId === item.id ? "Approving…" : "Approve and publish to library"}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
