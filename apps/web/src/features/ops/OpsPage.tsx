import type { ConnectorView, OpsOverviewView } from "@asaa/contracts";
import { useState } from "react";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { humanize } from "@/lib/utils";

function Counts({ label, values }: { label: string; values: Record<string, number> }) {
  const entries = Object.entries(values);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{label}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {entries.map(([key, count]) => (
            <li key={key}>
              <Badge>
                {humanize(key)}: {count}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Management view of operations, integrations and assets (D3.20, D3.21). */
export function OpsPage() {
  const overview = useResource<{ overview: OpsOverviewView }>("/ops/overview");
  const connectors = useResource<{ connectors: ConnectorView[] }>("/connectors");
  const [health, setHealth] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function check(id: string) {
    setError("");
    try {
      const result = await api<{ health: { ok: boolean; status: string; latencyMs: number } }>(
        `/connectors/${id}/health`,
      );
      setHealth((current) => ({ ...current, [id]: `${result.health.status} (${result.health.latencyMs} ms)` }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Health check failed.");
    }
  }

  async function trigger(connector: ConnectorView) {
    setError("");
    setMessage("");
    try {
      const job = connector.scope.jobs?.[0] ?? "";
      const result = await api<{ build: { buildId: string } }>(`/connectors/${connector.id}/builds`, {
        method: "POST",
        body: { job },
      });
      setMessage(`Started ${job} on ${connector.label} (build ${result.build.buildId}).`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not start the build.");
    }
  }

  async function revoke(connector: ConnectorView) {
    if (!window.confirm(`Revoke ${connector.label}? It stops working until the server restarts.`)) return;
    setError("");
    try {
      await api(`/connectors/${connector.id}/revoke`, { method: "POST" });
      connectors.reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not revoke the connector.");
    }
  }

  if (overview.state === "loading") return <LoadingState label="Loading operations overview" />;
  if (overview.state === "error") return <ErrorState error={overview.error} onRetry={overview.reload} />;
  const data = overview.data.overview;

  return (
    <>
      <PageHeader
        title="Operations and assets"
        description="Health of jobs, deliveries, events, connectors and the template asset inventory."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              overview.reload();
              connectors.reload();
            }}
          >
            Refresh
          </Button>
        }
      />
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      {message && (
        <Alert tone="success" className="mb-4">
          {message}
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Jobs running" value={data.jobs.runningNow} />
        <Stat label="Job failures (24 h)" value={data.jobs.failedLast24h} />
        <Stat label="Delivery requests waiting" value={data.delivery.pending} />
        <Stat label="Template submissions waiting" value={data.templates.pendingSubmissions} />
        <Stat label="Event outbox pending" value={data.events.pending} />
        <Stat label="Event outbox failed" value={data.events.failed} />
        <Stat label="Catalogue assets" value={data.assets.total} />
        <Stat label="Assets without sector" value={data.assets.unsectored} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Counts label="Jobs" values={data.jobs.byStatus} />
            <Counts label="Generations" values={data.generations.byStatus} />
            <Counts label="Deliveries" values={data.delivery.byStatus} />
            <Counts label="Template releases" values={data.templates.releasesByStatus} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Asset inventory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Counts label="By kind" values={data.assets.byKind} />
            <Counts label="By lifecycle" values={data.assets.byLifecycle} />
            <Counts label="By trust" values={data.assets.byTrust} />
            <Counts label="By sector" values={data.assets.bySector} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Assets needing attention</CardTitle>
        </CardHeader>
        <CardContent>
          {data.assets.attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
          ) : (
            <ul className="divide-y text-sm" aria-label="Assets needing attention">
              {data.assets.attention.map((item) => (
                <li key={item.id} className="py-2">
                  <span className="font-medium">{item.title}</span>{" "}
                  <span className="text-muted-foreground">({item.slug})</span>
                  <span className="block text-xs text-muted-foreground">{item.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Connectors</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            JARVIS mini-features: {data.integrations.jarvisEnabled ? "enabled" : "off"} · Local AI:{" "}
            {data.integrations.aiEnabled ? "enabled" : "off"}. Local mock connectors are always available; Jenkins and
            Nexus appear only when an owner configures them.
          </p>
          {connectors.state === "loading" && <LoadingState label="Loading connectors" rows={2} />}
          {connectors.state === "error" && <ErrorState error={connectors.error} onRetry={connectors.reload} />}
          {connectors.state === "ready" && (
            <ul className="divide-y" aria-label="Connectors">
              {connectors.data.connectors.map((connector) => (
                <li key={connector.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {connector.label} <Badge>{connector.origin === "local-mock" ? "Local mock" : "Configured"}</Badge>{" "}
                      {connector.revoked && <StatusBadge value="DENIED" />}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {humanize(connector.kind)} · {connector.capabilities.join(", ")} · scope{" "}
                      {(connector.scope.jobs ?? connector.scope.repositories ?? []).join(", ") || "none granted"}
                    </p>
                    {health[connector.id] && <p className="text-xs">Health: {health[connector.id]}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void check(connector.id)}>
                      Check health
                    </Button>
                    {connector.kind === "BUILD" && !connector.revoked && (connector.scope.jobs?.length ?? 0) > 0 && (
                      <Button size="sm" variant="outline" onClick={() => void trigger(connector)}>
                        Start build
                      </Button>
                    )}
                    {!connector.revoked && (
                      <Button size="sm" variant="ghost" onClick={() => void revoke(connector)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
