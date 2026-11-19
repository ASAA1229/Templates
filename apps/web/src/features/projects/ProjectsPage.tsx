import { PROJECT_STATUSES, type ProjectView } from "@asaa/contracts";
import { FolderPlus, Rocket, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { formatDateTime, humanize } from "@/lib/utils";
import { ProjectForm } from "./ProjectForm";

/** Project list with search/filter and inline creation (US-C01). */
export function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const creating = params.get("new") === "1";
  const status = params.get("status") ?? "";
  const archived = params.get("archived") ?? "exclude";
  const search = new URLSearchParams({
    ...(params.get("q") ? { q: params.get("q")! } : {}),
    ...(status ? { status } : {}),
    archived,
  });
  const projects = useResource<{ projects: ProjectView[] }>(`/projects?${search}`);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Projects"
        description="Create and manage software projects and their requirements."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Projects" }]}
        actions={
          !creating && (
            <>
              <Button asChild>
                <Link to="/projects/new">
                  <Rocket aria-hidden="true" /> Initialize project
                </Link>
              </Button>
              <Button variant="outline" onClick={() => update("new", "1")}>
                <FolderPlus aria-hidden="true" /> New project
              </Button>
            </>
          )
        }
      />

      {creating && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New project</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectForm
              submitLabel="Create project"
              onCancel={() => update("new", "")}
              onSubmit={async (input) => {
                const { project } = await api<{ project: ProjectView }>("/projects", { method: "POST", body: input });
                navigate(`/projects/${project.id}`);
              }}
            />
          </CardContent>
        </Card>
      )}

      <form
        role="search"
        className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          update("q", query.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="project-search">Search</Label>
          <Input
            id="project-search"
            type="search"
            placeholder="Name, key or purpose"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-status">Status</Label>
          <Select id="project-status" value={status} onChange={(event) => update("status", event.target.value)}>
            <option value="">All statuses</option>
            {PROJECT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-archived">Archive</Label>
          <Select id="project-archived" value={archived} onChange={(event) => update("archived", event.target.value)}>
            <option value="exclude">Active only</option>
            <option value="only">Archived only</option>
            <option value="include">All</option>
          </Select>
        </div>
        <Button type="submit" variant="outline">
          <Search aria-hidden="true" /> Search
        </Button>
      </form>

      {projects.state === "loading" && <LoadingState label="Loading projects" />}
      {projects.state === "error" && <ErrorState error={projects.error} onRetry={projects.reload} />}
      {projects.state === "ready" &&
        (projects.data.projects.length === 0 ? (
          <EmptyState
            title="No projects found"
            description={
              params.get("q") || status
                ? "Try a different search or filter."
                : "Create your first project to start capturing requirements."
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" aria-label="Projects">
            {projects.data.projects.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${project.id}`}
                  className="block rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="min-w-0 break-all text-xs font-semibold tracking-wide text-muted-foreground">
                        {project.key}
                      </p>
                      <h2 className="truncate font-semibold">{project.name}</h2>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {project.archivedAt && <Badge tone="warning">Archived</Badge>}
                      <StatusBadge value={project.status} />
                    </div>
                  </div>
                  {project.purpose && (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{project.purpose}</p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {project.requirementCount ?? 0} requirement(s) · updated {formatDateTime(project.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}
