import type { ProjectView, RequirementView } from "@asaa/contracts";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { formatDateTime, humanize } from "@/lib/utils";
import { ProjectForm } from "./ProjectForm";
import { RequirementCard } from "./RequirementCard";
import { RequirementForm } from "./RequirementForm";

interface ProjectDetail {
  project: ProjectView;
  history: { id: string; at: string; action: string; outcome: string }[];
}

/** Project detail: metadata, archive/restore, history and requirements (US-C01/C02/C04). */
export function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const detail = useResource<ProjectDetail>(`/projects/${projectId}`);
  const list = useResource<{ requirements: RequirementView[] }>(`/projects/${projectId}/requirements`);
  const [requirements, setRequirements] = useState<RequirementView[]>([]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (list.state === "ready") setRequirements(list.data.requirements);
  }, [list.state, list.data]);

  if (detail.state === "loading") return <LoadingState label="Loading project" />;
  if (detail.state === "error") {
    return detail.error.status === 404 ? (
      <EmptyState title="Project not found" description="It may have been removed or the link is wrong." />
    ) : (
      <ErrorState error={detail.error} onRetry={detail.reload} />
    );
  }

  const { project, history } = detail.data;
  const archived = Boolean(project.archivedAt);

  async function toggleArchive() {
    setMessage("");
    try {
      await api(`/projects/${project.id}/${archived ? "restore" : "archive"}`, { method: "POST" });
      detail.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Action failed.");
    }
  }

  return (
    <>
      <PageHeader
        title={project.name}
        description={`${project.key} · created ${formatDateTime(project.createdAt)}`}
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Projects", to: "/projects" }, { label: project.key }]}
        actions={
          <>
            {!archived && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> Edit
              </Button>
            )}
            <Button variant="outline" onClick={() => void toggleArchive()}>
              {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              {archived ? "Restore" : "Archive"}
            </Button>
          </>
        }
      />
      {message && (
        <Alert tone="danger" className="mb-4">
          {message}
        </Alert>
      )}
      {archived && (
        <Alert tone="warning" className="mb-4">
          Archived {formatDateTime(project.archivedAt!)}. Restore it to make changes.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {editing ? (
            <Card>
              <CardHeader>
                <CardTitle>Edit project</CardTitle>
              </CardHeader>
              <CardContent>
                <ProjectForm
                  initial={project}
                  submitLabel="Save project"
                  onCancel={() => setEditing(false)}
                  onSubmit={async ({ name, purpose, status }) => {
                    await api(`/projects/${project.id}`, {
                      method: "PATCH",
                      body: { name, purpose, status, expectedVersion: project.version },
                    });
                    setEditing(false);
                    detail.reload();
                  }}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>Overview</CardTitle>
                  <StatusBadge value={project.status} />
                  {archived && <Badge tone="warning">Archived</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{project.purpose || "No purpose recorded yet."}</p>
              </CardContent>
            </Card>
          )}

          <section aria-labelledby="requirements-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="requirements-heading" className="text-lg font-semibold">
                Requirements and user stories
              </h2>
              {!archived && !adding && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus aria-hidden="true" /> Add requirement
                </Button>
              )}
            </div>
            {adding && (
              <Card>
                <CardContent className="pt-5">
                  <RequirementForm
                    others={requirements}
                    submitLabel="Create requirement"
                    onCancel={() => setAdding(false)}
                    onSubmit={async (input) => {
                      const { requirement } = await api<{ requirement: RequirementView }>(
                        `/projects/${project.id}/requirements`,
                        {
                          method: "POST",
                          body: input,
                        },
                      );
                      setRequirements((current) => [...current, requirement]);
                      setAdding(false);
                    }}
                  />
                </CardContent>
              </Card>
            )}
            {list.state === "loading" && <LoadingState label="Loading requirements" rows={2} />}
            {list.state === "error" && <ErrorState error={list.error} onRetry={list.reload} />}
            {list.state === "ready" &&
              (requirements.length === 0 ? (
                <EmptyState
                  title="No requirements yet"
                  description="Capture user stories with acceptance criteria to plan and trace delivery."
                />
              ) : (
                <ul className="space-y-3" aria-label="Requirements">
                  {requirements.map((requirement) => (
                    <RequirementCard
                      key={requirement.id}
                      projectId={project.id}
                      requirement={requirement}
                      all={requirements}
                      readOnly={archived}
                      onChange={(next) =>
                        setRequirements((current) => current.map((item) => (item.id === next.id ? next : item)))
                      }
                    />
                  ))}
                </ul>
              ))}
          </section>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {history.map((event) => (
                <li key={event.id}>
                  <span className="font-medium">{humanize(event.action.replace("project.", ""))}</span>
                  <span className="block text-xs text-muted-foreground">{formatDateTime(event.at)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
