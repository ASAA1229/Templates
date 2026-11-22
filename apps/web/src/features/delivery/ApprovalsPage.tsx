import type { DeliveryRequestView } from "@asaa/contracts";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/utils";

/** Management inbox for repository handoff and deployment requests (D3.13, D3.14). */
export function DeliveryApprovalsPage() {
  const [items, setItems] = useState<DeliveryRequestView[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ requests: DeliveryRequestView[] }>(
        `/delivery/requests?status=${showAll ? "all" : "REQUESTED"}`,
      );
      setItems(result.requests);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not load delivery requests.");
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    setError("");
    try {
      await api(`/delivery/requests/${id}/${decision}`, { method: "POST", body: { note: notes[id] ?? "" } });
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Decision failed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <PageHeader
        title="Delivery approvals"
        description="Repository handoffs and deployments run only after a management decision. Built-in providers are local; nothing is sent to an external host."
        actions={
          <Button variant="outline" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Show pending only" : "Show all requests"}
          </Button>
        }
      />
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      {loading ? (
        <LoadingState label="Loading delivery requests" rows={2} />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing to review" description="New handoff and deployment requests will appear here." />
      ) : (
        <ul className="space-y-3" aria-label="Delivery requests">
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle>
                      {humanize(item.kind)} · {item.projectKey}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Target {item.target || "—"} via {item.provider} · requested {formatDateTime(item.createdAt)}
                    </p>
                    {item.note && <p className="mt-1 text-sm">{item.note}</p>}
                  </div>
                  <StatusBadge value={item.status} />
                </CardHeader>
                {item.status === "REQUESTED" && (
                  <CardContent className="flex flex-wrap items-center gap-2">
                    <Input
                      className="max-w-xs"
                      aria-label={`Decision note for ${item.projectKey}`}
                      placeholder="Decision note (optional)"
                      value={notes[item.id] ?? ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                    <Button disabled={busyId === item.id} onClick={() => void decide(item.id, "approve")}>
                      Approve and run
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busyId === item.id}
                      onClick={() => void decide(item.id, "reject")}
                    >
                      Reject
                    </Button>
                  </CardContent>
                )}
                {item.status === "EXECUTED" && item.result && (
                  <CardContent className="text-xs text-muted-foreground">
                    Result: {String(item.result.location ?? item.result.filename ?? "recorded")}
                  </CardContent>
                )}
                {item.status === "FAILED" && item.result && (
                  <CardContent className="text-xs text-destructive">
                    {String(item.result.error ?? "Failed")}
                  </CardContent>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
