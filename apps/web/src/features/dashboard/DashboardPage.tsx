import type { DashboardView } from "@asaa/contracts";
import { AlertTriangle, FolderPlus } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useResource } from "@/lib/hooks";
import { formatDateTime, humanize } from "@/lib/utils";

function Metric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Owner dashboard (US-B01): status, alerts and recent activity. */
export function DashboardPage() {
  const { owner } = useAuth();
  const dashboard = useResource<DashboardView>("/dashboard");

  return (
    <>
      <PageHeader
        title={`Welcome${owner ? `, ${owner.displayName}` : ""}`}
        description="Projects, requirements and catalog health at a glance."
        actions={
          <Button asChild>
            <Link to="/projects?new=1">
              <FolderPlus aria-hidden="true" /> New project
            </Link>
          </Button>
        }
      />
      {dashboard.state === "loading" && <LoadingState label="Loading dashboard" />}
      {dashboard.state === "error" && <ErrorState error={dashboard.error} onRetry={dashboard.reload} />}
      {dashboard.state === "ready" && (
        <div className="space-y-6">
          {dashboard.data.projects.total === 0 && dashboard.data.catalog.total === 0 ? (
            <EmptyState
              title="Nothing here yet"
              description="Create your first project to start capturing requirements, or register a template in the catalog."
              action={
                <Button asChild>
                  <Link to="/projects?new=1">Create a project</Link>
                </Button>
              }
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Active projects"
              value={dashboard.data.projects.total}
              hint={`${dashboard.data.projects.archived} archived`}
            />
            <Metric label="Requirements" value={dashboard.data.requirements.total} />
            <Metric
              label="Missing verification"
              value={dashboard.data.requirements.missingVerification}
              hint="Developed or later without passing test evidence"
            />
            <Metric
              label="Catalog items"
              value={dashboard.data.catalog.total}
              hint={`${dashboard.data.catalog.untrusted} awaiting review`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Alerts</CardTitle>
                <CardDescription>Items that need your attention.</CardDescription>
              </CardHeader>
              <CardContent>
                {dashboard.data.alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No alerts. Everything that needs evidence has it.</p>
                ) : (
                  <ul className="space-y-2">
                    {dashboard.data.alerts.map((alert, index) => (
                      <li key={index}>
                        <Link to={alert.href} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-accent">
                          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                          <span>
                            <span className="sr-only">{humanize(alert.kind)}: </span>
                            {alert.message}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Projects by status</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3">
                  {Object.entries(dashboard.data.projects.byStatus).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between rounded-md border p-3">
                      <dt>
                        <StatusBadge value={status} />
                      </dt>
                      <dd className="text-lg font-semibold tabular-nums">{count}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.data.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              ) : (
                <ul className="divide-y">
                  {dashboard.data.recentActivity.map((event) => (
                    <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="font-medium">{humanize(event.action.replace(/\./g, " "))}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <StatusBadge value={event.outcome} />
                        <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/audit" className="mt-3 inline-block text-sm text-primary hover:underline">
                View full audit log
              </Link>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
