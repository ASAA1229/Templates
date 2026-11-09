import {
  branchPolicySchema,
  createBranchSchema,
  fieldErrors,
  gitIdentitySchema,
  remoteUrlProblem,
  type BranchCreateResultView,
  type BranchKind,
  type RepositoryRecordView,
  type WorkspaceView,
} from "@asaa/contracts";
import { AlertTriangle, GitBranch, GitCommitHorizontal, GitFork, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader } from "@/components/common";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { formatDateTime, humanize } from "@/lib/utils";
import { EnvironmentPanel } from "./EnvironmentPanel";

const short = (sha: string | null) => (sha ? sha.slice(0, 10) : "—");
const STATE_TONES = {
  added: "success",
  modified: "info",
  deleted: "danger",
  renamed: "info",
  untracked: "neutral",
  conflicted: "danger",
  typechange: "warning",
} as const;

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await task();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, "INTERNAL", "Unexpected error."));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

/** Engineering workspace for one generated project (US-F01, US-F02, US-F03). */
export function WorkspacePage() {
  const { projectId = "" } = useParams();
  const resource = useResource<{ workspace: WorkspaceView }>(`/projects/${projectId}/workspace`);

  if (resource.state === "loading") return <LoadingState label="Loading engineering workspace" />;
  if (resource.state === "error") {
    return resource.error.status === 404 ? (
      <EmptyState title="Project not found" description="It may have been removed or the link is wrong." />
    ) : (
      <ErrorState error={resource.error} onRetry={resource.reload} />
    );
  }
  const workspace = resource.data.workspace;
  const { project } = workspace;
  const readOnly = project.archived;
  const base = `/projects/${project.id}/workspace`;

  return (
    <>
      <PageHeader
        title="Engineering workspace"
        description={`${project.key} · ${project.name}`}
        breadcrumbs={[
          { label: "Dashboard", to: "/" },
          { label: "Projects", to: "/projects" },
          { label: project.key, to: `/projects/${project.id}` },
          { label: "Workspace" },
        ]}
      />

      {!workspace.output.available ? (
        <EmptyState
          title="No project folder yet"
          description={workspace.output.reason ?? "This project has no generated folder."}
          action={
            <Button asChild variant="outline">
              <Link to="/projects/new">Initialize a project</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {!workspace.git.available && (
            <Alert tone="danger">
              <strong className="block">Git is unavailable.</strong>
              {workspace.git.message} Repository features are disabled until Git is installed on the server.
            </Alert>
          )}
          {workspace.warnings.length > 0 && (
            <Alert tone="warning">
              <ul className="space-y-1">
                {workspace.warnings.map((warning) => (
                  <li key={warning} className="flex gap-2">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    {warning}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="min-w-0 space-y-4">
              <RepositoryCard workspace={workspace} base={base} readOnly={readOnly} onChanged={resource.reload} />
              {workspace.state && <WorkingTreeCard workspace={workspace} />}
              {workspace.state && <HistoryCard workspace={workspace} />}
            </div>
            <div className="min-w-0 space-y-4">
              {workspace.state && workspace.repository && (
                <BranchesCard
                  workspace={workspace}
                  repository={workspace.repository}
                  base={base}
                  readOnly={readOnly}
                  onChanged={resource.reload}
                />
              )}
              {workspace.repository && (
                <ConfigurationCard
                  repository={workspace.repository}
                  base={base}
                  readOnly={readOnly}
                  onChanged={resource.reload}
                />
              )}
              <ProvidersCard workspace={workspace} />
            </div>
          </div>
          <EnvironmentPanel projectId={project.id} readOnly={readOnly} onSaved={resource.reload} />
          <ActivityCard workspace={workspace} />
        </div>
      )}
    </>
  );
}

function RepositoryCard({
  workspace,
  base,
  readOnly,
  onChanged,
}: {
  workspace: WorkspaceView;
  base: string;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [identity, setIdentity] = useState({ name: "", email: "" });
  const [initialCommit, setInitialCommit] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const { repository, state, detection } = workspace;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = gitIdentitySchema.safeParse(identity);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const result = await action.run(() =>
      api(`${base}/repository`, { method: "POST", body: { identity: parsed.data, initialCommit } }),
    );
    if (result) onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Repository</CardTitle>
          <Badge
            tone={
              detection === "registered"
                ? "success"
                : detection === "unsafe" || detection === "missing"
                  ? "danger"
                  : "neutral"
            }
          >
            {detection === "registered"
              ? "Initialized"
              : detection === "existing"
                ? "Existing repository found"
                : detection === "unsafe"
                  ? "Unsafe .git entry"
                  : detection === "missing"
                    ? "Repository missing"
                    : "Not initialized"}
          </Badge>
        </div>
        <CardDescription>
          Local Git repository in the project folder <code className="font-mono">{workspace.output.outputDir}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {repository && state && (
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Current branch</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{state.head.branch ?? "(detached)"}</span>
              {state.head.branch && repository.policy.protectedBranches.includes(state.head.branch) && (
                <Badge tone="warning">
                  <Lock aria-hidden="true" className="mr-1 size-3" /> Protected
                </Badge>
              )}
            </dd>
            <dt className="text-muted-foreground">Commit</dt>
            <dd className="font-mono text-xs break-all" title={state.head.sha ?? undefined}>
              {state.head.sha ?? "No commits yet"}
            </dd>
            <dt className="text-muted-foreground">Default branch</dt>
            <dd className="font-mono">{repository.defaultBranch}</dd>
            <dt className="text-muted-foreground">Identity</dt>
            <dd className="break-all">
              {repository.identity.name} &lt;{repository.identity.email}&gt;
            </dd>
            <dt className="text-muted-foreground">Remote</dt>
            <dd className="break-all">{repository.remote ? repository.remote.url : "None (local only)"}</dd>
            <dt className="text-muted-foreground">Initialized</dt>
            <dd>
              {formatDateTime(repository.initializedAt)}
              {repository.adoptedExisting && " (existing repository registered)"}
            </dd>
          </dl>
        )}
        {(detection === "none" || detection === "existing") && workspace.git.available && !readOnly && (
          <form
            aria-label="Initialize repository"
            noValidate
            className="space-y-3"
            onSubmit={(event) => void submit(event)}
          >
            <p className="text-sm text-muted-foreground">
              {detection === "existing"
                ? "This folder already contains a Git repository. Register it to manage branches here; history is kept as is."
                : "Create a Git repository on the production branch and commit the generated files."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Author name" error={errors.name ?? action.error?.fields["identity.name"]}>
                <Input
                  value={identity.name}
                  onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
                />
              </Field>
              <Field label="Author email" error={errors.email ?? action.error?.fields["identity.email"]}>
                <Input
                  type="email"
                  value={identity.email}
                  onChange={(event) => setIdentity({ ...identity, email: event.target.value })}
                />
              </Field>
            </div>
            {detection === "none" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={initialCommit}
                  onChange={(event) => setInitialCommit(event.target.checked)}
                />
                Commit the generated files as the first commit
              </label>
            )}
            {action.error && Object.keys(action.error.fields).length === 0 && <ErrorState error={action.error} />}
            <Button type="submit" disabled={action.busy}>
              <GitFork aria-hidden="true" />
              {action.busy ? "Working…" : detection === "existing" ? "Register repository" : "Initialize repository"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function WorkingTreeCard({ workspace }: { workspace: WorkspaceView }) {
  const status = workspace.state!.status;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Working tree</CardTitle>
        <CardDescription>Uncommitted changes in the project folder.</CardDescription>
      </CardHeader>
      <CardContent>
        {status.clean ? (
          <p className="text-sm text-muted-foreground">Working tree is clean.</p>
        ) : (
          <ul aria-label="Changed files" className="max-h-72 space-y-1 overflow-auto text-sm">
            {status.entries.map((entry) => (
              <li key={`${entry.state}:${entry.path}`} className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-mono text-xs break-all">
                  {entry.from ? `${entry.from} → ` : ""}
                  {entry.path}
                </span>
                <span className="flex shrink-0 gap-1">
                  {entry.staged && <Badge tone="info">Staged</Badge>}
                  <Badge tone={STATE_TONES[entry.state]}>{humanize(entry.state)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
        {status.truncated && <p className="mt-2 text-xs text-muted-foreground">Showing the first 500 changes.</p>}
      </CardContent>
    </Card>
  );
}

function HistoryCard({ workspace }: { workspace: WorkspaceView }) {
  const commits = workspace.state!.commits;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Commit history</CardTitle>
        <CardDescription>Most recent commits on the current branch.</CardDescription>
      </CardHeader>
      <CardContent>
        {commits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No commits yet.</p>
        ) : (
          <ol aria-label="Commits" className="space-y-3">
            {commits.map((commit) => (
              <li key={commit.sha} className="flex gap-3 text-sm">
                <GitCommitHorizontal aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="font-medium break-words">{commit.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono" title={commit.sha}>
                      {short(commit.sha)}
                    </span>{" "}
                    · {commit.author} · {formatDateTime(commit.date)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

const KIND_LABELS = (repository: RepositoryRecordView): Record<BranchKind, string> => ({
  feature: `Feature (${repository.policy.featurePrefix}/…)`,
  fix: `Fix (${repository.policy.fixPrefix}/…)`,
  test: `Test (${repository.policy.testPrefix}/…)`,
  integration: `Integration (${repository.policy.integrationBranch})`,
});

function BranchesCard({
  workspace,
  repository,
  base,
  readOnly,
  onChanged,
}: {
  workspace: WorkspaceView;
  repository: RepositoryRecordView;
  base: string;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const branches = workspace.state!.branches;
  const [kind, setKind] = useState<BranchKind>("feature");
  const [topic, setTopic] = useState("");
  const [from, setFrom] = useState("");
  const [switchTo, setSwitchTo] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BranchCreateResultView | null>(null);
  const action = useAction();
  const labels = KIND_LABELS(repository);
  const preview =
    kind === "integration"
      ? repository.policy.integrationBranch
      : `${repository.policy[`${kind}Prefix` as const]}${topic ? `/${topic.toLowerCase()}` : ""}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    const body = { kind, topic: kind === "integration" ? undefined : topic, from: from || undefined, switchTo };
    const parsed = createBranchSchema.safeParse(body);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const created = await action.run(() => api<BranchCreateResultView>(`${base}/branches`, { method: "POST", body }));
    if (created) {
      setResult(created);
      setTopic("");
      onChanged();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branches</CardTitle>
        <CardDescription>
          {repository.policy.productionBranch} is production, {repository.policy.integrationBranch} is integration. Work
          happens on {repository.policy.featurePrefix}/, {repository.policy.fixPrefix}/ and{" "}
          {repository.policy.testPrefix}/ branches. Nothing is ever merged automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul aria-label="Branches" className="space-y-1 text-sm">
          {branches.map((branch) => (
            <li key={branch.name} className="flex flex-wrap items-center gap-2">
              <GitBranch aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="font-mono break-all">{branch.name}</span>
              {branch.current && <Badge tone="info">Current</Badge>}
              {branch.protected && <Badge tone="warning">Protected</Badge>}
              <span className="text-xs text-muted-foreground">{humanize(branch.role)}</span>
            </li>
          ))}
          {branches.length === 0 && <li className="text-muted-foreground">No branches yet. Create a first commit.</li>}
        </ul>
        {!readOnly && (
          <form
            aria-label="Create branch"
            noValidate
            className="space-y-3 border-t pt-4"
            onSubmit={(event) => void submit(event)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Branch type">
                <Select value={kind} onChange={(event) => setKind(event.target.value as BranchKind)}>
                  {(Object.keys(labels) as BranchKind[]).map((value) => (
                    <option key={value} value={value}>
                      {labels[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Topic"
                hint={kind === "integration" ? "The integration branch has a fixed name." : `Creates ${preview}`}
                error={errors.topic ?? action.error?.fields.topic}
              >
                <Input
                  disabled={kind === "integration"}
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                />
              </Field>
              <Field
                label="Start from"
                hint="Defaults to the integration branch when it exists."
                error={action.error?.fields.from}
              >
                <Select value={from} onChange={(event) => setFrom(event.target.value)}>
                  <option value="">Policy default</option>
                  {branches.map((branch) => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={switchTo} onChange={(event) => setSwitchTo(event.target.checked)} />
                Switch to the new branch
              </label>
            </div>
            {action.error && Object.keys(action.error.fields).length === 0 && <ErrorState error={action.error} />}
            {result && (
              <Alert tone={result.warnings.length ? "warning" : "success"}>
                <strong className="block">Created {result.branch.name}.</strong>
                {result.warnings.length > 0 && (
                  <ul className="list-disc pl-4">
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}
            <Button type="submit" disabled={action.busy || !workspace.state?.head.sha}>
              <GitBranch aria-hidden="true" /> {action.busy ? "Creating…" : "Create branch"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigurationCard({
  repository,
  base,
  readOnly,
  onChanged,
}: {
  repository: RepositoryRecordView;
  base: string;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [identity, setIdentity] = useState(repository.identity);
  const [remote, setRemote] = useState(repository.remote?.url ?? "");
  const [protectedBranches, setProtectedBranches] = useState(repository.policy.protectedBranches.join(", "));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");
  const action = useAction();

  async function save(kind: "identity" | "remote" | "policy", event: FormEvent) {
    event.preventDefault();
    setSaved("");
    setErrors({});
    let body: Record<string, unknown>;
    if (kind === "identity") {
      const parsed = gitIdentitySchema.safeParse(identity);
      if (!parsed.success)
        return setErrors(
          Object.fromEntries(Object.entries(fieldErrors(parsed.error)).map(([k, v]) => [`identity.${k}`, v])),
        );
      body = { identity: parsed.data };
    } else if (kind === "remote") {
      const url = remote.trim() || null;
      const problem = url ? remoteUrlProblem(url) : null;
      if (problem) return setErrors({ url: problem });
      body = { url };
    } else {
      const list = protectedBranches
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const parsed = branchPolicySchema.safeParse({ ...repository.policy, protectedBranches: list });
      if (!parsed.success)
        return setErrors({ protectedBranches: Object.values(fieldErrors(parsed.error))[0] ?? "Invalid policy." });
      body = { policy: parsed.data };
    }
    const result = await action.run(() =>
      api(`${base}/repository/${kind}`, { method: "PUT", body: { ...body, expectedVersion: repository.version } }),
    );
    if (result) {
      setSaved(kind === "identity" ? "Identity saved." : kind === "remote" ? "Remote saved." : "Branch policy saved.");
      onChanged();
    }
  }

  const fieldError = (key: string) => errors[key] ?? action.error?.fields[key];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repository configuration</CardTitle>
        <CardDescription>Project-level settings. Credentials are never stored by the platform.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset disabled={readOnly} className="space-y-5">
          <form
            aria-label="Commit identity"
            noValidate
            className="space-y-3"
            onSubmit={(event) => void save("identity", event)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Commit author name" error={fieldError("identity.name")}>
                <Input
                  value={identity.name}
                  onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
                />
              </Field>
              <Field label="Commit author email" error={fieldError("identity.email")}>
                <Input
                  type="email"
                  value={identity.email}
                  onChange={(event) => setIdentity({ ...identity, email: event.target.value })}
                />
              </Field>
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={action.busy}>
              Save identity
            </Button>
          </form>
          <form aria-label="Remote" noValidate className="space-y-3" onSubmit={(event) => void save("remote", event)}>
            <Field
              label="Remote URL (origin)"
              hint="https:// or git@host:owner/repo.git without credentials. Recorded only; nothing is pushed or fetched."
              error={fieldError("url")}
            >
              <Input
                value={remote}
                placeholder="https://github.com/owner/repo.git"
                onChange={(event) => setRemote(event.target.value)}
              />
            </Field>
            <Button type="submit" size="sm" variant="outline" disabled={action.busy}>
              {remote.trim() ? "Save remote" : "Remove remote"}
            </Button>
          </form>
          <form
            aria-label="Branch policy"
            noValidate
            className="space-y-3"
            onSubmit={(event) => void save("policy", event)}
          >
            <Field
              label="Protected branches"
              hint={`Comma-separated. ${repository.policy.productionBranch} must stay protected. Reviews required for: ${repository.policy.requireReviewFor.join(", ") || "none"} (advisory for local repositories).`}
              error={fieldError("protectedBranches")}
            >
              <Input value={protectedBranches} onChange={(event) => setProtectedBranches(event.target.value)} />
            </Field>
            <Button type="submit" size="sm" variant="outline" disabled={action.busy}>
              Save policy
            </Button>
          </form>
        </fieldset>
        {saved && <Alert tone="success">{saved}</Alert>}
        {action.error && Object.keys(action.error.fields).length === 0 && <ErrorState error={action.error} />}
      </CardContent>
    </Card>
  );
}

function ProvidersCard({ workspace }: { workspace: WorkspaceView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source-control providers</CardTitle>
      </CardHeader>
      <CardContent>
        <ul aria-label="Providers" className="space-y-2 text-sm">
          {workspace.providers.map((provider) => (
            <li key={provider.provider} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 font-medium">
                {provider.label}
                <Badge tone={provider.available ? "success" : "neutral"}>
                  {provider.available ? "Available" : "Planned"}
                </Badge>
              </span>
              <span className="text-xs text-muted-foreground">{provider.note}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ActivityCard({ workspace }: { workspace: WorkspaceView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent repository activity</CardTitle>
      </CardHeader>
      <CardContent>
        {workspace.activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No repository or environment activity yet.</p>
        ) : (
          <ol aria-label="Repository activity" className="space-y-2 text-sm">
            {workspace.activity.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{humanize(event.action.replace(/^(repository|environment)\./, ""))}</span>
                {typeof event.metadata.branch === "string" && (
                  <span className="font-mono text-xs">{event.metadata.branch}</span>
                )}
                <span className="text-xs text-muted-foreground">{formatDateTime(event.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
