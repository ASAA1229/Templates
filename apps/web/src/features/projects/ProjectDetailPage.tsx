import type { GenerationView, ProjectView, RequirementView } from "@asaa/contracts";
import { Archive, ArchiveRestore, Code2, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { formatDateTime, humanize } from "@/lib/utils";
import { GenerationCard } from "@/features/generation/GenerationPanel";
import { ProjectForm } from "./ProjectForm";
import { RequirementCard } from "./RequirementCard";
import { RequirementForm } from "./RequirementForm";
import { ProjectTemplateContribution } from "@/features/templates/ProjectTemplateContribution";
import { ProjectMembersPanel } from "./ProjectMembersPanel";

interface ProjectDetail {
  project: ProjectView;
  history: { id: string; at: string; action: string; outcome: string }[];
  access: "OWNER" | "VIEWER" | "EDITOR";
}

/** Project detail: metadata, archive/restore, history and requirements (US-C01/C02/C04). */
export function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const detail = useResource<ProjectDetail>(`/projects/${projectId}`);
  const list = useResource<{ requirements: RequirementView[] }>(`/projects/${projectId}/requirements`);
  const generations = useResource<{ generations: GenerationView[] }>(
    /^[0-9a-f-]{36}$/i.test(projectId) ? `/generations?projectId=${projectId}` : null,
  );
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
  const readOnly = archived || detail.data.access === "VIEWER";
  const isOwner = detail.data.access === "OWNER";

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
            {generations.state === "ready" && generations.data.generations[0]?.status === "SUCCEEDED" && (
              <Button asChild>
                <Link to={`/projects/${project.id}/workspace`}>
                  <Code2 aria-hidden="true" /> Engineering workspace
                </Link>
              </Button>
            )}
            {!readOnly && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> Edit
              </Button>
            )}
            {isOwner && <Button variant="outline" onClick={() => void toggleArchive()}>
              {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              {archived ? "Restore" : "Archive"}
            </Button>}
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
                {project.blueprint && (
                  <div className="mt-4 space-y-2 border-t pt-4">
                    <h3 className="text-sm font-semibold">Project blueprint</h3>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="info">{humanize(project.blueprint.family)}</Badge>
                      <Badge>{humanize(project.blueprint.architecture)}</Badge>
                      {project.blueprint.packageManager && <Badge>{project.blueprint.packageManager}</Badge>}
                    </div>
                    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-sm">
                      {[
                        ["Runtimes", project.blueprint.runtimes],
                        ["Languages", project.blueprint.languages],
                        ["Frameworks", project.blueprint.frameworks],
                        ["Databases", project.blueprint.databases],
                        ["APIs", project.blueprint.apis],
                        ["Infrastructure", project.blueprint.infrastructure],
                      ]
                        .filter(([, values]) => (values as { name: string; version: string }[]).length > 0)
                        .map(([label, values]) => (
                          <div key={label as string} className="contents">
                            <dt className="text-muted-foreground">{label as string}</dt>
                            <dd>
                              {(values as { name: string; version: string }[])
                                .map((item) => `${item.name} ${item.version}`)
                                .join(", ")}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {generations.state === "ready" && generations.data.generations[0]?.status === "SUCCEEDED" && isOwner && !archived && (
            <ProjectTemplateContribution projectId={project.id} onSubmitted={generations.reload} />
          )}

          {generations.state === "ready" && generations.data.generations[0] && (
            <GenerationCard
              key={generations.data.generations[0].id}
              generation={generations.data.generations[0]}
              onChanged={generations.reload}
            />
          )}

          <section aria-labelledby="requirements-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="requirements-heading" className="text-lg font-semibold">
                Requirements and user stories
              </h2>
              {!readOnly && !adding && (
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
                      readOnly={readOnly}
                      onChange={(next) =>
                        setRequirements((current) => current.map((item) => (item.id === next.id ? next : item)))
                      }
                    />
                  ))}
                </ul>
              ))}
          </section>
        </div>

        <div className="space-y-6">
        <ProjectMembersPanel projectId={project.id} />
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
      </div>
    </>
  );
}
