import type { DeliveryProviderView, DeliveryRequestView } from "@asaa/contracts";
import { Download, GitBranch, Rocket } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge } from "@/components/common";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { ApiError, api, apiDownload } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/utils";

/**
 * Project delivery: confirmed ZIP/workspace exports, and requests for repository handoff or deployment that
 * management must approve (D3.12-D3.14). Everything is recorded in the delivery ledger shown here.
 */
export function DeliveryPanel({ projectId }: { projectId: string }) {
  const [requests, setRequests] = useState<DeliveryRequestView[]>([]);
  const [providers, setProviders] = useState<DeliveryProviderView[]>([]);
  const [scope, setScope] = useState<"ZIP_EXPORT" | "WORKSPACE_EXPORT">("ZIP_EXPORT");
  const [confirm, setConfirm] = useState(false);
  const [kind, setKind] = useState<"REPOSITORY_HANDOFF" | "DEPLOYMENT">("REPOSITORY_HANDOFF");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    try {
      const [list, available] = await Promise.all([
        api<{ requests: DeliveryRequestView[] }>(`/projects/${projectId}/delivery`),
        api<{ providers: DeliveryProviderView[] }>(`/projects/${projectId}/delivery/providers`),
      ]);
      setRequests(list.requests);
      setProviders(available.providers);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load delivery.");
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const role = kind === "REPOSITORY_HANDOFF" ? "REPOSITORY_HOST" : "DEPLOYMENT";
  const usable = providers.filter((provider) => provider.role === role && provider.available);
  const environments = usable.flatMap((provider) => provider.environments ?? []);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const exportNow = (event: FormEvent) => {
    event.preventDefault();
    void run(
      async () => `Downloaded ${await apiDownload(`/projects/${projectId}/delivery/export`, { scope, confirm })}.`,
    );
  };
  const request = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api(`/projects/${projectId}/delivery/requests`, {
        method: "POST",
        body: { kind, provider: usable[0]?.id, target: target || environments[0], note },
      });
      setTarget("");
      setNote("");
      return "Request sent for management approval.";
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {message && <Alert tone="success">{message}</Alert>}

        <form onSubmit={exportNow} className="space-y-2" aria-label="Export project">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Download aria-hidden="true" className="size-4" /> Export as ZIP
          </h3>
          <Label htmlFor="export-scope" className="sr-only">
            Export scope
          </Label>
          <Select id="export-scope" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
            <option value="ZIP_EXPORT">Generated project</option>
            <option value="WORKSPACE_EXPORT">Workspace with repository state</option>
          </Select>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={confirm}
              onChange={(event) => setConfirm(event.target.checked)}
            />
            I am allowed to take a copy of this project out of the platform. The export is recorded in the audit log.
          </label>
          <Button type="submit" size="sm" disabled={!confirm || busy}>
            Download ZIP
          </Button>
        </form>

        <form onSubmit={request} className="space-y-2 border-t pt-4" aria-label="Request delivery">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {kind === "REPOSITORY_HANDOFF" ? (
              <GitBranch aria-hidden="true" className="size-4" />
            ) : (
              <Rocket aria-hidden="true" className="size-4" />
            )}
            Request handoff or deployment
          </h3>
          <Label htmlFor="delivery-kind" className="sr-only">
            Delivery type
          </Label>
          <Select
            id="delivery-kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as typeof kind);
              setTarget("");
            }}
          >
            <option value="REPOSITORY_HANDOFF">Repository handoff</option>
            <option value="DEPLOYMENT">Deployment</option>
          </Select>
          {kind === "REPOSITORY_HANDOFF" ? (
            <Input
              aria-label="Repository name"
              placeholder="repository-name"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              required
            />
          ) : (
            <Select
              aria-label="Environment"
              value={target || environments[0] || ""}
              onChange={(event) => setTarget(event.target.value)}
            >
              {environments.map((environment) => (
                <option key={environment} value={environment}>
                  {humanize(environment)}
                </option>
              ))}
            </Select>
          )}
          <Input
            aria-label="Note"
            placeholder="Note for the approver (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {usable[0] && (
            <p className="text-xs text-muted-foreground">
              {usable[0].label}: {usable[0].note}
            </p>
          )}
          <Button type="submit" size="sm" variant="outline" disabled={busy || usable.length === 0}>
            Send for approval
          </Button>
        </form>

        <div className="border-t pt-4">
          <h3 className="mb-2 text-sm font-semibold">Delivery history</h3>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has left this project yet.</p>
          ) : (
            <ol className="space-y-2 text-sm" aria-label="Delivery history">
              {requests.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{humanize(entry.kind)}</span>
                    <StatusBadge value={entry.status} />
                    {entry.target && <span className="text-muted-foreground">{entry.target}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                  {entry.status === "REQUESTED" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-fit"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/projects/${projectId}/delivery/requests/${entry.id}/cancel`, { method: "POST" });
                          return "Request cancelled.";
                        })
                      }
                    >
                      Cancel request
                    </Button>
                  )}
                  {entry.status === "FAILED" && entry.result && (
                    <span className="text-xs text-destructive">{String(entry.result.error ?? "Failed")}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
