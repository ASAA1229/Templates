import type { AuditEventView } from "@asaa/contracts";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import { Button, Label, Select } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

interface Page {
  events: AuditEventView[];
  nextBefore: string | null;
}

/** Read-only audit trail (US-I02); sensitive values are redacted server-side. */
export function AuditPage() {
  const [outcome, setOutcome] = useState("");
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<ApiError | null>(null);

  async function load(before?: string) {
    const params = new URLSearchParams({ limit: "50", ...(outcome ? { outcome } : {}), ...(before ? { before } : {}) });
    try {
      const page = await api<Page>(`/audit?${params}`);
      setEvents((current) => (before ? [...current, ...page.events] : page.events));
      setNext(page.nextBefore);
      setState("ready");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, "INTERNAL", "Could not load the audit log."));
      setState("error");
    }
  }

  useEffect(() => {
    setState("loading");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of sign-ins, changes and denied actions."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Audit log" }]}
      />
      <div className="mb-4 max-w-xs space-y-1.5">
        <Label htmlFor="audit-outcome">Outcome</Label>
        <Select id="audit-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          <option value="">All outcomes</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILURE">Failure</option>
          <option value="DENIED">Denied</option>
        </Select>
      </div>
      {state === "loading" && <LoadingState label="Loading audit log" />}
      {state === "error" && error && <ErrorState error={error} onRetry={() => void load()} />}
      {state === "ready" &&
        (events.length === 0 ? (
          <EmptyState title="No events" description="Nothing matches this filter yet." />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Audit events, newest first</caption>
              <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Time
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Actor
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Target
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{event.action}</td>
                    <td className="px-4 py-2">{event.actorType.toLowerCase()}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {event.targetType ? `${event.targetType}` : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge value={event.outcome} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {next && state === "ready" && (
        <Button variant="outline" className="mt-4" onClick={() => void load(next)}>
          Load older events
        </Button>
      )}
    </>
  );
}
