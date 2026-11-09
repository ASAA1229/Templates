import {
  DATABASE_ENGINES,
  environmentSpecSchema,
  fieldErrors,
  PACKAGE_MANAGERS,
  type EnvironmentCheckView,
  type EnvironmentSpec,
  type EnvironmentView,
} from "@asaa/contracts";
import { Plus, Stethoscope, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorState, Field, LoadingState } from "@/components/common";
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
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { formatDateTime } from "@/lib/utils";

type Variable = EnvironmentSpec["variables"][number];
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** "node >=24" or "postgresql >=16 optional" per line. */
function parseTools(text: string) {
  return lines(text).map((line) => {
    const [name = "", version = "*", flag] = line.split(/\s+/);
    return { name, version, required: flag !== "optional" };
  });
}
const formatTools = (tools: EnvironmentSpec["tools"]) =>
  tools.map((tool) => `${tool.name} ${tool.version}${tool.required ? "" : " optional"}`).join("\n");

interface Draft {
  tools: string;
  packageManager: EnvironmentSpec["packageManager"];
  install: string;
  dev: string;
  build: string;
  test: string;
  variables: Variable[];
  database: EnvironmentSpec["database"];
  notes: string;
}

const toDraft = (spec: EnvironmentSpec): Draft => ({
  tools: formatTools(spec.tools),
  packageManager: spec.packageManager,
  install: spec.commands.install.join("\n"),
  dev: spec.commands.dev.join("\n"),
  build: spec.commands.build.join("\n"),
  test: spec.commands.test.join("\n"),
  variables: spec.variables,
  database: spec.database,
  notes: spec.notes,
});

const fromDraft = (draft: Draft) => ({
  schemaVersion: 1,
  tools: parseTools(draft.tools),
  packageManager: draft.packageManager,
  commands: {
    install: lines(draft.install),
    dev: lines(draft.dev),
    build: lines(draft.build),
    test: lines(draft.test),
  },
  variables: draft.variables,
  database: draft.database,
  notes: draft.notes,
});

/** Reproducible environment specification and host check (US-F03). */
export function EnvironmentPanel({
  projectId,
  readOnly,
  onSaved,
}: {
  projectId: string;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const resource = useResource<{ environment: EnvironmentView }>(`/projects/${projectId}/workspace/environment`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [version, setVersion] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [check, setCheck] = useState<EnvironmentCheckView | null>(null);
  const [busy, setBusy] = useState<"save" | "check" | null>(null);

  useEffect(() => {
    if (resource.state === "ready") {
      setDraft(toDraft(resource.data.environment.spec));
      setVersion(resource.data.environment.version);
    }
  }, [resource.state, resource.data]);

  if (resource.state === "loading" || (resource.state === "ready" && !draft)) {
    return <LoadingState label="Loading environment" rows={1} />;
  }
  if (resource.state === "error") return <ErrorState error={resource.error} onRetry={resource.reload} />;
  const view = resource.data.environment;
  const current = draft!;
  const set = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });
  const setVariable = (index: number, patch: Partial<Variable>) =>
    set({ variables: current.variables.map((variable, i) => (i === index ? { ...variable, ...patch } : variable)) });

  async function save() {
    setMessage(null);
    const candidate = fromDraft(current);
    const parsed = environmentSpecSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setMessage({ tone: "danger", text: "Some environment details need attention." });
      return;
    }
    setErrors({});
    setBusy("save");
    try {
      const result = await api<{ environment: EnvironmentView }>(`/projects/${projectId}/workspace/environment`, {
        method: "PUT",
        body: { spec: parsed.data, expectedVersion: version },
      });
      setVersion(result.environment.version);
      setDraft(toDraft(result.environment.spec));
      setMessage({ tone: "success", text: "Environment specification saved to the platform and the project folder." });
      resource.reload();
      onSaved();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(
          Object.fromEntries(Object.entries(error.fields).map(([key, value]) => [key.replace(/^spec\./, ""), value])),
        );
        setMessage({ tone: "danger", text: error.message });
      }
    } finally {
      setBusy(null);
    }
  }

  async function runCheck() {
    setBusy("check");
    setMessage(null);
    try {
      const result = await api<{ check: EnvironmentCheckView }>(`/projects/${projectId}/workspace/environment/check`, {
        method: "POST",
      });
      setCheck(result.check);
      onSaved();
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof ApiError ? error.message : "Check failed." });
    } finally {
      setBusy(null);
    }
  }

  const errorFor = (prefix: string) =>
    Object.entries(errors).find(([key]) => key === prefix || key.startsWith(`${prefix}.`))?.[1];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Development environment</CardTitle>
          <Badge tone={view.source === "saved" ? "success" : "neutral"}>
            {view.source === "saved" ? "Saved" : "Inferred, not saved"}
          </Badge>
        </div>
        <CardDescription>
          Runtime and tool versions, commands and variable names needed to set the project up again. Secret values are
          never stored.
          {view.updatedAt && ` Last saved ${formatDateTime(view.updatedAt)}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          aria-label="Environment specification"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={readOnly} className="space-y-4">
            <Field
              label="Tools and versions"
              hint="One per line: name and version, e.g. “node >=24”. Add “optional” for non-required tools. Allowed: node, npm, pnpm, yarn, git, postgresql, docker."
              error={errorFor("tools")}
            >
              <Textarea rows={3} value={current.tools} onChange={(event) => set({ tools: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Package manager" error={errorFor("packageManager")}>
                <Select
                  value={current.packageManager.name}
                  onChange={(event) =>
                    set({
                      packageManager: {
                        ...current.packageManager,
                        name: event.target.value as EnvironmentSpec["packageManager"]["name"],
                      },
                    })
                  }
                >
                  {PACKAGE_MANAGERS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Package manager version" error={errorFor("packageManager.version")}>
                <Input
                  value={current.packageManager.version}
                  onChange={(event) =>
                    set({ packageManager: { ...current.packageManager, version: event.target.value } })
                  }
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["install", "Install commands"],
                  ["dev", "Development commands"],
                  ["build", "Build commands"],
                  ["test", "Test commands"],
                ] as const
              ).map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  hint="One command per line. Recorded only; never run by the platform."
                  error={errorFor(`commands.${key}`)}
                >
                  <Textarea rows={2} value={current[key]} onChange={(event) => set({ [key]: event.target.value })} />
                </Field>
              ))}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Environment variables</legend>
              <p className="text-xs text-muted-foreground">
                Names and descriptions only. Mark credentials as secret; secret variables cannot have example values.
              </p>
              {current.variables.length === 0 && <p className="text-sm text-muted-foreground">No variables listed.</p>}
              <ul className="space-y-2" aria-label="Environment variables">
                {current.variables.map((variable, index) => (
                  <li key={index} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[10rem_1fr_8rem_auto]">
                    <Input
                      aria-label={`Variable ${index + 1} name`}
                      placeholder="NAME"
                      value={variable.name}
                      onChange={(event) => setVariable(index, { name: event.target.value.toUpperCase() })}
                    />
                    <Input
                      aria-label={`Variable ${index + 1} description`}
                      placeholder="Description"
                      value={variable.description}
                      onChange={(event) => setVariable(index, { description: event.target.value })}
                    />
                    <Input
                      aria-label={`Variable ${index + 1} example`}
                      placeholder={variable.secret ? "(secret)" : "Example"}
                      disabled={variable.secret}
                      value={variable.example}
                      onChange={(event) => setVariable(index, { example: event.target.value })}
                    />
                    <div className="flex items-center gap-3 text-sm">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={variable.required}
                          onChange={(event) => setVariable(index, { required: event.target.checked })}
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={variable.secret}
                          onChange={(event) =>
                            setVariable(index, {
                              secret: event.target.checked,
                              example: event.target.checked ? "" : variable.example,
                            })
                          }
                        />
                        Secret
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove variable ${variable.name || index + 1}`}
                        onClick={() => set({ variables: current.variables.filter((_, i) => i !== index) })}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                    {errorFor(`variables.${index}`) && (
                      <p className="text-xs font-medium text-destructive sm:col-span-4">
                        {errorFor(`variables.${index}`)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  set({
                    variables: [
                      ...current.variables,
                      { name: "", description: "", required: false, secret: false, example: "" },
                    ],
                  })
                }
              >
                <Plus aria-hidden="true" /> Add variable
              </Button>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Local database" error={errorFor("database")}>
                <Select
                  value={current.database.engine}
                  onChange={(event) =>
                    set({
                      database: {
                        ...current.database,
                        engine: event.target.value as EnvironmentSpec["database"]["engine"],
                      },
                    })
                  }
                >
                  {DATABASE_ENGINES.map((engine) => (
                    <option key={engine} value={engine}>
                      {engine}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Database version" error={errorFor("database.version")}>
                <Input
                  value={current.database.version}
                  onChange={(event) => set({ database: { ...current.database, version: event.target.value } })}
                />
              </Field>
            </div>
            <Field label="Setup notes" error={errorFor("notes")}>
              <Textarea rows={2} value={current.notes} onChange={(event) => set({ notes: event.target.value })} />
            </Field>
          </fieldset>
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <div className="flex flex-wrap gap-2">
            {!readOnly && (
              <Button type="submit" disabled={busy !== null}>
                {busy === "save" ? "Saving…" : "Save environment"}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void runCheck()}>
              <Stethoscope aria-hidden="true" /> {busy === "check" ? "Checking…" : "Check this machine"}
            </Button>
          </div>
        </form>

        {check && (
          <section aria-labelledby="environment-check" className="space-y-2">
            <div className="flex items-center gap-2">
              <Label id="environment-check" className="text-sm font-semibold">
                Machine check
              </Label>
              <Badge tone={check.ok ? "success" : "warning"}>{check.ok ? "Ready" : "Missing requirements"}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Tool availability on the server machine</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Tool
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Required
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Found
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {check.results.map((result) => (
                    <tr key={result.name} className="border-t">
                      <td className="py-1 pr-3 font-medium">{result.name}</td>
                      <td className="py-1 pr-3">
                        {result.requirement}
                        {!result.required && " (optional)"}
                      </td>
                      <td className="py-1 pr-3">{result.version ?? "—"}</td>
                      <td className="py-1">
                        <Badge tone={result.ok ? "success" : result.required ? "danger" : "warning"}>
                          {result.ok ? "OK" : result.found ? "Version mismatch" : "Missing"}
                        </Badge>
                        <span className="sr-only"> {result.message}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Read-only version checks; nothing is installed or changed on this machine.
            </p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
