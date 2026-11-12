import {
  createGenerationSchema,
  fieldErrors,
  generationProjectSchema,
  type ProjectBlueprint,
  templateInputValuesSchema,
  templateManifestSchema,
  type GenerationPreviewView,
  type GenerationView,
  type ProjectType,
  type StarterOptionView,
  type TemplateInputValues,
  type TemplateManifest,
  type TemplateOptionView,
} from "@asaa/contracts";
import { ArrowLeft, ArrowRight, Check, FilePlus2, LayoutTemplate, Loader2, Rocket } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import { Alert, Badge, Button, Card, CardContent, Input, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { cn, humanize } from "@/lib/utils";
import { GenerationDetails } from "./GenerationPanel";
import { cleanInputValues, defaultInputValues, TemplateInputsForm } from "./TemplateInputsForm";

type Mode = "SCRATCH" | "TEMPLATE";
type Step = "start" | "source" | "configure" | "review" | "result";
const STEPS: { id: Step; label: string }[] = [
  { id: "start", label: "Start" },
  { id: "source", label: "Source" },
  { id: "configure", label: "Configure" },
  { id: "review", label: "Review" },
  { id: "result", label: "Result" },
];
const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  "web-app": "Web application",
  "api-service": "API service",
  blank: "Blank project",
};

interface Options {
  templates: TemplateOptionView[];
  starters: StarterOptionView[];
}

/** Validate a manifest received from the API before using it to build forms (boundary re-validation). */
function parseManifest(raw: unknown): { manifest: TemplateManifest | null; problem: string | null } {
  const parsed = templateManifestSchema.safeParse(raw);
  return parsed.success
    ? { manifest: parsed.data, problem: null }
    : { manifest: null, problem: "This template definition failed validation and cannot be used." };
}

function Progress({ step }: { step: Step }) {
  const index = STEPS.findIndex((item) => item.id === step);
  return (
    <ol aria-label="Progress" className="mb-6 grid grid-cols-5 gap-2 text-xs sm:text-sm">
      {STEPS.map((item, position) => (
        <li
          key={item.id}
          aria-current={position === index ? "step" : undefined}
          className={cn(
            "flex flex-col gap-1 border-t-4 pt-2",
            position < index && "border-primary text-foreground",
            position === index && "border-primary font-semibold text-foreground",
            position > index && "border-muted text-muted-foreground",
          )}
        >
          <span className="sr-only">
            {position < index ? "Completed: " : position === index ? "Current: " : "Upcoming: "}
          </span>
          {item.label}
        </li>
      ))}
    </ol>
  );
}

function ChoiceCard({
  selected,
  disabled,
  onSelect,
  title,
  description,
  icon,
  children,
  name,
  value,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  icon?: ReactNode;
  children?: ReactNode;
  name: string;
  value: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-xl border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring",
        selected && "border-primary bg-primary/5",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
        </span>
        <span className="block text-sm text-muted-foreground">{description}</span>
        {children}
      </span>
    </label>
  );
}

/**
 * Guided project initialization (US-E01, US-E02): choose scratch or template,
 * pick the source, configure from the manifest, review the exact output, then
 * generate and see provenance, with recovery when something fails.
 */
export function NewProjectWizard() {
  const [params] = useSearchParams();
  const options = useResource<Options>("/templates/options");
  const preselected = params.get("template");
  const [step, setStep] = useState<Step>(preselected ? "source" : "start");
  const [mode, setMode] = useState<Mode | null>(preselected ? "TEMPLATE" : null);
  const [projectType, setProjectType] = useState<ProjectType | null>(null);
  const [starterId, setStarterId] = useState<string | null>(null);
  const [starterVersion, setStarterVersion] = useState<string | null>(null);
  const [blueprintFamily, setBlueprintFamily] = useState("web-app");
  const [blueprintArchitecture, setBlueprintArchitecture] = useState("single-page-app");
  const [catalogItemId, setCatalogItemId] = useState<string | null>(preselected);
  const [project, setProject] = useState({ key: "", name: "", purpose: "" });
  const [inputs, setInputs] = useState<TemplateInputValues>({});
  const [requirementsText, setRequirementsText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<GenerationPreviewView | null>(null);
  const [requestError, setRequestError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [generation, setGeneration] = useState<GenerationView | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  useEffect(() => {
    // Move focus to the new step's heading so keyboard and screen-reader users follow along.
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const starters = options.data?.starters ?? [];
  const templates = options.data?.templates ?? [];
  const selectedTemplate = templates.find((option) => option.catalogItem.id === catalogItemId) ?? null;
  const starterBlueprints = starters.flatMap((starter) => {
    const parsed = parseManifest(starter.manifest).manifest;
    return parsed?.blueprint
      ? [
          {
            id: starter.id,
            version: starter.version,
            projectType: starter.projectType,
            blueprint: parsed.blueprint,
            manifest: parsed,
          },
        ]
      : [];
  });
  const availableFamilies = [...new Set(starterBlueprints.map((item) => item.blueprint.family))];
  const activeFamily = availableFamilies.includes(blueprintFamily as ProjectBlueprint["family"])
    ? blueprintFamily
    : (availableFamilies[0] ?? "general");
  const availableArchitectures = [
    ...new Set(
      starterBlueprints
        .filter((item) => item.blueprint.family === activeFamily)
        .map((item) => item.blueprint.architecture),
    ),
  ];
  const activeArchitecture = availableArchitectures.includes(blueprintArchitecture as ProjectBlueprint["architecture"])
    ? blueprintArchitecture
    : (availableArchitectures[0] ?? "minimal");
  const selectedStarter =
    starters.find((starter) => starter.id === starterId && starter.version === starterVersion) ?? null;
  const source = useMemo(() => {
    if (mode === "TEMPLATE" && selectedTemplate) return parseManifest(selectedTemplate.manifest);
    if (mode === "SCRATCH" && selectedStarter) return parseManifest(selectedStarter.manifest);
    return { manifest: null, problem: null };
  }, [mode, selectedTemplate, selectedStarter]);
  const manifest = source.manifest;
  const selectedBlueprint = manifest?.blueprint ?? null;
  const requirements = requirementsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const request = () =>
    mode === "TEMPLATE"
      ? {
          mode,
          catalogItemId: catalogItemId ?? "",
          blueprint: manifest?.blueprint,
          project,
          inputs: manifest ? cleanInputValues(manifest.inputs, inputs) : {},
          requirements,
        }
      : {
          mode: "SCRATCH" as const,
          projectType: projectType ?? "blank",
          starterId: selectedStarter?.id,
          starterVersion: selectedStarter?.version,
          blueprint: manifest?.blueprint,
          project,
          inputs: manifest ? cleanInputValues(manifest.inputs, inputs) : {},
          requirements,
        };

  function chooseSource(next: {
    type?: ProjectType;
    starterId?: string;
    starterVersion?: string;
    templateId?: string;
  }) {
    setProjectType(next.type ?? null);
    setStarterId(next.starterId ?? null);
    setStarterVersion(next.starterVersion ?? null);
    setCatalogItemId(next.templateId ?? null);
    setInputs({});
    setErrors({});
  }

  function goConfigure() {
    if (!manifest) return;
    setInputs((current) => (Object.keys(current).length ? current : defaultInputValues(manifest.inputs)));
    setStep("configure");
  }

  /** Client-side validation with the same schemas the API enforces. */
  function validate(): boolean {
    const next: Record<string, string> = {};
    const projectResult = generationProjectSchema.safeParse(project);
    if (!projectResult.success) {
      for (const [key, message] of Object.entries(fieldErrors(projectResult.error))) next[`project.${key}`] = message;
    }
    if (manifest) {
      const values = templateInputValuesSchema(manifest.inputs).safeParse(cleanInputValues(manifest.inputs, inputs));
      if (!values.success) {
        for (const [key, message] of Object.entries(fieldErrors(values.error))) next[`inputs.${key}`] = message;
      }
    }
    const whole = createGenerationSchema.safeParse(request());
    if (!whole.success) {
      for (const [key, message] of Object.entries(fieldErrors(whole.error))) {
        if (key.startsWith("requirements")) next.requirements ??= message;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function applyServerError(error: ApiError) {
    if (error.status === 400 && Object.keys(error.fields).length > 0) {
      setErrors(error.fields);
      setStep("configure");
      return;
    }
    setRequestError(error);
  }

  async function review() {
    if (!validate()) return;
    setPending(true);
    setRequestError(null);
    try {
      const result = await api<{ preview: GenerationPreviewView }>("/generations/preview", {
        method: "POST",
        body: request(),
      });
      setPreview(result.preview);
      setStep("review");
    } catch (error) {
      if (error instanceof ApiError) applyServerError(error);
    } finally {
      setPending(false);
    }
  }

  async function generate() {
    setPending(true);
    setRequestError(null);
    setStep("result");
    try {
      const result = await api<{ generation: GenerationView }>("/generations", { method: "POST", body: request() });
      setGeneration(result.generation);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 400 && Object.keys(error.fields).length > 0) applyServerError(error);
        else setRequestError(error);
      }
    } finally {
      setPending(false);
    }
  }

  const projectError = (key: string) => errors[`project.${key}`];
  const inputErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key.startsWith("inputs."))
      .map(([key, message]) => [key.slice("inputs.".length), message]),
  );

  const heading = (text: string, description?: string) => (
    <div className="mb-4">
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
        {text}
      </h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );

  return (
    <>
      <PageHeader
        title="New project"
        description="Initialize a project from an approved template or from scratch. Output is generated as an independent folder."
        breadcrumbs={[
          { label: "Dashboard", to: "/" },
          { label: "Projects", to: "/projects" },
          { label: "New project" },
        ]}
      />
      <Progress step={step} />

      {options.state === "loading" && <LoadingState label="Loading templates" rows={2} />}
      {options.state === "error" && <ErrorState error={options.error} onRetry={options.reload} />}

      {options.state === "ready" && step === "start" && (
        <section>
          {heading("How do you want to start?")}
          <fieldset className="grid gap-3 md:grid-cols-2">
            <legend className="sr-only">Starting point</legend>
            <ChoiceCard
              name="start"
              value="TEMPLATE"
              selected={mode === "TEMPLATE"}
              onSelect={() => setMode("TEMPLATE")}
              icon={<LayoutTemplate aria-hidden="true" className="size-4" />}
              title="Start from a template"
              description="Use an approved, trusted template from your catalog. Its version and content digest are recorded."
            />
            <ChoiceCard
              name="start"
              value="SCRATCH"
              selected={mode === "SCRATCH"}
              onSelect={() => setMode("SCRATCH")}
              icon={<FilePlus2 aria-hidden="true" className="size-4" />}
              title="Start from scratch"
              description="Pick a project type and technology choices; an approved starter structure is generated."
            />
          </fieldset>
          <div className="mt-6 flex flex-wrap justify-between gap-2">
            <Button variant="ghost" asChild>
              <Link to="/projects">Cancel</Link>
            </Button>
            <Button disabled={!mode} onClick={() => setStep("source")}>
              Continue <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </section>
      )}

      {options.state === "ready" && step === "source" && mode === "SCRATCH" && (
        <section>
          {heading(
            "Choose a project type",
            "Each type uses an approved starter structure maintained with the platform.",
          )}
          {starters.length === 0 ? (
            <EmptyState title="No starters available" description="The starter library could not be loaded." />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Project family">
                  <select
                    aria-label="Project family"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={activeFamily}
                    onChange={(event) => {
                      setBlueprintFamily(event.target.value);
                      const nextArchitecture = starterBlueprints.find(
                        (item) => item.blueprint.family === event.target.value,
                      )?.blueprint.architecture;
                      setBlueprintArchitecture(nextArchitecture ?? "minimal");
                      setProjectType(null);
                      setStarterId(null);
                      setStarterVersion(null);
                    }}
                  >
                    {availableFamilies.map((family) => (
                      <option key={family} value={family}>
                        {humanize(family)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Architecture">
                  <select
                    aria-label="Architecture"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={activeArchitecture}
                    onChange={(event) => {
                      setBlueprintArchitecture(event.target.value);
                      setProjectType(null);
                      setStarterId(null);
                      setStarterVersion(null);
                    }}
                  >
                    {availableArchitectures.map((architecture) => (
                      <option key={architecture} value={architecture}>
                        {humanize(architecture)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="text-sm text-muted-foreground">
                Only starters compatible with this family and architecture are shown.
              </p>
              <fieldset className="grid gap-3 md:grid-cols-3">
                <legend className="sr-only">Compatible project starter</legend>
                {starterBlueprints
                  .filter(
                    (item) =>
                      item.blueprint.family === activeFamily && item.blueprint.architecture === activeArchitecture,
                  )
                  .map((item) => (
                    <ChoiceCard
                      key={`${item.id}@${item.version}`}
                      name="starter"
                      value={`${item.id}@${item.version}`}
                      selected={starterId === item.id && starterVersion === item.version}
                      onSelect={() =>
                        chooseSource({
                          type: item.projectType,
                          starterId: item.id,
                          starterVersion: item.version,
                        })
                      }
                      title={item.manifest.title}
                      description={`${item.manifest.description || PROJECT_TYPE_LABELS[item.projectType]} · v${item.version}`}
                    >
                      <span className="flex flex-wrap gap-1 pt-1">
                        {item.manifest.technologies.map((tech) => (
                          <Badge key={tech.name} tone="info">
                            {tech.name} {tech.version}
                          </Badge>
                        ))}
                      </span>
                    </ChoiceCard>
                  ))}
              </fieldset>
              {availableArchitectures.length === 0 && (
                <EmptyState title="No compatible architecture" description="Choose another project family." />
              )}
            </div>
          )}
          <StepNav onBack={() => setStep("start")} onNext={goConfigure} nextDisabled={!manifest} />
        </section>
      )}

      {options.state === "ready" && step === "source" && mode === "TEMPLATE" && (
        <section>
          {heading("Choose a template", "Only active, trusted templates with approved content can be used.")}
          {templates.length === 0 ? (
            <EmptyState
              title="No templates in your catalog yet"
              description="Approve a template from the local template library in the catalog, or start from scratch."
              action={
                <Button asChild variant="outline">
                  <Link to="/catalog">Open template catalog</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <fieldset className="space-y-3">
                <legend className="sr-only">Template</legend>
                {templates.map((option) => (
                  <ChoiceCard
                    key={option.catalogItem.id}
                    name="template"
                    value={option.catalogItem.id}
                    disabled={!option.eligible}
                    selected={catalogItemId === option.catalogItem.id}
                    onSelect={() => chooseSource({ templateId: option.catalogItem.id })}
                    title={option.catalogItem.title}
                    description={`${option.catalogItem.category} · v${option.catalogItem.version}`}
                  >
                    {!option.eligible && (
                      <span className="block text-xs text-foreground">Not available: {option.reasons.join(" ")}</span>
                    )}
                  </ChoiceCard>
                ))}
              </fieldset>
              {selectedTemplate ? (
                <TemplateDetail option={selectedTemplate} problem={source.problem} manifest={manifest} />
              ) : (
                <p className="text-sm text-muted-foreground">Select a template to see its details.</p>
              )}
            </div>
          )}
          <StepNav
            onBack={() => setStep("start")}
            onNext={goConfigure}
            nextDisabled={!manifest || !selectedTemplate?.eligible}
          />
        </section>
      )}

      {step === "configure" && manifest && (
        <section>
          {heading("Configure the project", `Settings for ${manifest.title} v${manifest.version}.`)}
          <form
            noValidate
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void review();
            }}
          >
            {Object.keys(errors).length > 0 && (
              <Alert tone="danger">Some details need attention. Check the highlighted fields.</Alert>
            )}
            <Card>
              <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
                <Field
                  label="Project key"
                  hint="2–20 letters, digits or hyphens. Also names the output folder."
                  error={projectError("key")}
                >
                  <Input
                    autoComplete="off"
                    value={project.key}
                    onChange={(event) => setProject({ ...project, key: event.target.value.toUpperCase() })}
                  />
                </Field>
                <Field label="Project name" error={projectError("name")}>
                  <Input
                    value={project.name}
                    onChange={(event) => setProject({ ...project, name: event.target.value })}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Purpose" error={projectError("purpose")}>
                    <Textarea
                      rows={2}
                      value={project.purpose}
                      onChange={(event) => setProject({ ...project, purpose: event.target.value })}
                    />
                  </Field>
                </div>
              </CardContent>
            </Card>
            <section aria-labelledby="template-settings" className="space-y-3">
              <h3 id="template-settings" className="font-semibold">
                {mode === "TEMPLATE" ? "Template settings" : "Technology choices"}
              </h3>
              <TemplateInputsForm inputs={manifest.inputs} values={inputs} errors={inputErrors} onChange={setInputs} />
            </section>
            <Field
              label="Initial requirements (optional)"
              hint="One per line. Each becomes a draft user story in the project."
              error={errors.requirements}
            >
              <Textarea
                rows={3}
                value={requirementsText}
                onChange={(event) => setRequirementsText(event.target.value)}
              />
            </Field>
            {requestError && <ErrorState error={requestError} />}
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("source")}>
                <ArrowLeft aria-hidden="true" /> Back
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                Review
              </Button>
            </div>
          </form>
        </section>
      )}

      {step === "review" && manifest && preview && (
        <section>
          {heading("Review before generating", "Nothing has been written yet. This is exactly what will be generated.")}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-5">
                <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Project</dt>
                  <dd>
                    {project.name} ({project.key})
                  </dd>
                  <dt className="text-muted-foreground">Source</dt>
                  <dd>
                    {manifest.title} · {preview.template.id}@{preview.template.version}
                  </dd>
                  <dt className="text-muted-foreground">Project blueprint</dt>
                  <dd>
                    {selectedBlueprint
                      ? `${humanize(selectedBlueprint.family)} · ${humanize(selectedBlueprint.architecture)}`
                      : "Legacy source — no structured blueprint"}
                  </dd>
                  {selectedBlueprint && (
                    <>
                      <dt className="text-muted-foreground">Runtime / language</dt>
                      <dd>
                        {[...selectedBlueprint.runtimes, ...selectedBlueprint.languages]
                          .map((item) => `${item.name} ${item.version}`)
                          .join(", ") || "Not specified"}
                      </dd>
                      <dt className="text-muted-foreground">Package manager</dt>
                      <dd>{selectedBlueprint.packageManager ?? "Not specified"}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Output folder</dt>
                  <dd className="font-mono text-xs">{preview.outputDir}</dd>
                  <dt className="text-muted-foreground">Size</dt>
                  <dd>
                    {preview.files.length} files · {(preview.totalBytes / 1024).toFixed(1)} KB
                  </dd>
                  <dt className="text-muted-foreground">Requirements</dt>
                  <dd>{requirements.length ? requirements.join("; ") : "None"}</dd>
                  {manifest.inputs.map((input) => (
                    <div key={input.id} className="contents">
                      <dt className="text-muted-foreground">{input.label}</dt>
                      <dd className="break-all">
                        {typeof inputs[input.id] === "boolean"
                          ? inputs[input.id]
                            ? "Yes"
                            : "No"
                          : String(inputs[input.id] ?? "") || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <h3 className="mb-2 text-sm font-semibold">Files to generate</h3>
                <ul aria-label="Files to generate" className="max-h-72 space-y-0.5 overflow-auto font-mono text-xs">
                  {preview.files.map((file) => (
                    <li key={file.path} className="flex justify-between gap-2">
                      <span className="break-all">{file.path}</span>
                      <span className="shrink-0 text-muted-foreground">{file.bytes} B</span>
                    </li>
                  ))}
                  {preview.directories.map((dir) => (
                    <li key={dir} className="text-muted-foreground">
                      {dir}/
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
          {preview.conflicts.length > 0 && (
            <Alert tone="warning" className="mt-4">
              <strong className="block">Resolve these before generating:</strong>
              <ul className="list-disc pl-4">
                {preview.conflicts.map((conflict) => (
                  <li key={conflict}>{conflict}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="mt-6 flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("configure")}>
              <ArrowLeft aria-hidden="true" /> Edit configuration
            </Button>
            <Button disabled={pending || preview.conflicts.length > 0} onClick={() => void generate()}>
              <Rocket aria-hidden="true" /> Generate project
            </Button>
          </div>
        </section>
      )}

      {step === "result" && (
        <section aria-busy={pending}>
          {heading(
            pending
              ? "Generating…"
              : generation?.status === "SUCCEEDED"
                ? "Project generated"
                : generation?.status === "FAILED"
                  ? "Generation failed"
                  : "Generation could not start",
          )}
          {pending && (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Validating, rendering and writing files…
            </div>
          )}
          {!pending && requestError && (
            <div className="space-y-4">
              <ErrorState error={requestError} />
              <Button variant="outline" onClick={() => setStep(preview ? "review" : "configure")}>
                <ArrowLeft aria-hidden="true" /> Back
              </Button>
            </div>
          )}
          {!pending && generation && (
            <Card>
              <CardContent className="space-y-4 pt-5">
                {generation.status === "SUCCEEDED" && (
                  <Alert tone="success">
                    <span className="flex items-center gap-2">
                      <Check aria-hidden="true" className="size-4" />
                      {generation.projectName} was generated in the output folder “{generation.outputDir}”.
                    </span>
                  </Alert>
                )}
                <GenerationDetails generation={generation} onChanged={setGeneration} />
                <Button asChild>
                  <Link to={`/projects/${generation.projectId}`}>Open project</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </>
  );
}

function StepNav({ onBack, onNext, nextDisabled }: { onBack: () => void; onNext: () => void; nextDisabled: boolean }) {
  return (
    <div className="mt-6 flex flex-wrap justify-between gap-2">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> Back
      </Button>
      <Button disabled={nextDisabled} onClick={onNext}>
        Continue <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}

function TemplateDetail({
  option,
  manifest,
  problem,
}: {
  option: TemplateOptionView;
  manifest: TemplateManifest | null;
  problem: string | null;
}) {
  const item = option.catalogItem;
  return (
    <Card aria-label="Template details">
      <CardContent className="space-y-3 pt-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{item.title}</h3>
          <StatusBadge value={item.lifecycle} />
          <StatusBadge value={item.trustStatus} />
        </div>
        {item.description && <p className="text-muted-foreground">{item.description}</p>}
        {problem && <Alert tone="danger">{problem}</Alert>}
        {!option.eligible && (
          <Alert tone="warning">
            <ul className="list-disc pl-4">
              {option.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Alert>
        )}
        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Version</dt>
          <dd>v{item.version}</dd>
          <dt className="text-muted-foreground">Technology</dt>
          <dd>{manifest ? manifest.technologies.map((t) => `${t.name} ${t.version}`).join(", ") : "—"}</dd>
          <dt className="text-muted-foreground">Dependencies</dt>
          <dd>
            {manifest && manifest.dependencies.length
              ? manifest.dependencies.map((d) => `${d.name}@${d.version}`).join(", ")
              : "None"}
          </dd>
          <dt className="text-muted-foreground">License</dt>
          <dd>{manifest?.license.spdx ?? item.license}</dd>
          <dt className="text-muted-foreground">Trust</dt>
          <dd>{humanize(item.trustStatus)}</dd>
          <dt className="text-muted-foreground">Maintainer</dt>
          <dd>{manifest?.provenance.maintainer ?? item.ownership}</dd>
          <dt className="text-muted-foreground">Content digest</dt>
          <dd className="font-mono text-xs break-all">
            {item.contentDigest ? `${item.contentDigest.slice(0, 16)}…` : "—"}
          </dd>
        </dl>
        {option.files.length > 0 && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">Template files ({option.files.length})</summary>
            <ul className="mt-2 space-y-0.5 font-mono text-xs">
              {option.files.map((file) => (
                <li key={file.source} className="break-all">
                  {file.target}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
