import {
  CATALOG_KINDS,
  createCatalogItemSchema,
  fieldErrors,
  LIFECYCLES,
  SOURCE_TYPES,
  type CatalogItemView,
} from "@asaa/contracts";
import { Plus, Rocket, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { humanize } from "@/lib/utils";
import { TemplateLibraryPanel } from "./TemplateLibraryPanel";
import { ToolsPanel } from "./ToolsPanel";

const csv = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Private template/asset catalog: browse, search, filter, register and review (US-D01, US-D02). */
export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [creating, setCreating] = useState(false);
  const filters = ["q", "category", "technology", "lifecycle", "kind"].filter((key) => params.get(key));
  const search = new URLSearchParams(filters.map((key) => [key, params.get(key)!]));
  const catalog = useResource<{ items: CatalogItemView[]; categories: string[] }>(`/catalog?${search}`);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Template catalog"
        description="Private templates, components and imported projects with versioned metadata."
        breadcrumbs={[{ label: "Dashboard", to: "/" }, { label: "Template catalog" }]}
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" /> Register item
            </Button>
          )
        }
      />
      {creating && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Register catalog item</CardTitle>
          </CardHeader>
          <CardContent>
            <CatalogForm
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                catalog.reload();
              }}
            />
          </CardContent>
        </Card>
      )}

      <TemplateLibraryPanel onApproved={catalog.reload} />
      <ToolsPanel />

      <form
        role="search"
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,10rem)_minmax(0,10rem)_auto] lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          set("q", query.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="catalog-search">Search</Label>
          <Input
            id="catalog-search"
            type="search"
            placeholder="Title, description, tag or technology"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="catalog-category">Category</Label>
          <Select
            id="catalog-category"
            value={params.get("category") ?? ""}
            onChange={(event) => set("category", event.target.value)}
          >
            <option value="">All</option>
            {catalog.data?.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="catalog-kind">Kind</Label>
          <Select
            id="catalog-kind"
            value={params.get("kind") ?? ""}
            onChange={(event) => set("kind", event.target.value)}
          >
            <option value="">All</option>
            {CATALOG_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {humanize(kind)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="catalog-lifecycle">Lifecycle</Label>
          <Select
            id="catalog-lifecycle"
            value={params.get("lifecycle") ?? ""}
            onChange={(event) => set("lifecycle", event.target.value)}
          >
            <option value="">All</option>
            {LIFECYCLES.map((lifecycle) => (
              <option key={lifecycle} value={lifecycle}>
                {humanize(lifecycle)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          <Search aria-hidden="true" /> Search
        </Button>
      </form>

      {catalog.state === "loading" && <LoadingState label="Loading catalog" />}
      {catalog.state === "error" && <ErrorState error={catalog.error} onRetry={catalog.reload} />}
      {catalog.state === "ready" &&
        (catalog.data.items.length === 0 ? (
          <EmptyState
            title={filters.length ? "No matching items" : "The catalog is empty"}
            description={
              filters.length
                ? "Try a different search or filter."
                : "Register a template or import an existing project to start building your reusable library."
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" aria-label="Catalog items">
            {catalog.data.items.map((item) => (
              <CatalogCard key={item.id} item={item} onChanged={catalog.reload} />
            ))}
          </ul>
        ))}
    </>
  );
}

function CatalogCard({ item, onChanged }: { item: CatalogItemView; onChanged: () => void }) {
  const [error, setError] = useState("");
  async function patch(body: Record<string, unknown>) {
    setError("");
    try {
      await api(`/catalog/${item.id}`, { method: "PATCH", body: { ...body, expectedVersion: item.rowVersion } });
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Update failed.");
    }
  }
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {humanize(item.kind)} · {item.category} · v{item.version}
          </p>
          <h2 className="font-semibold">{item.title}</h2>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <StatusBadge value={item.lifecycle} />
          <StatusBadge value={item.trustStatus} />
        </div>
      </div>
      {item.description && <p className="line-clamp-3 text-sm text-muted-foreground">{item.description}</p>}
      <div className="flex flex-wrap gap-1">
        {item.technologies.map((technology) => (
          <Badge key={technology} tone="info">
            {technology}
          </Badge>
        ))}
        {item.tags.map((tag) => (
          <Badge key={tag}>#{tag}</Badge>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>License</dt>
        <dd className="text-foreground">{item.license}</dd>
        <dt>Owner</dt>
        <dd className="text-foreground">{item.ownership}</dd>
        <dt>Source</dt>
        <dd className="break-all text-foreground">{item.sourceReference ?? humanize(item.sourceType)}</dd>
        <dt>Dependencies</dt>
        <dd className="text-foreground">
          {item.dependencies.length ? item.dependencies.map((dep) => `${dep.name}@${dep.version}`).join(", ") : "None"}
        </dd>
      </dl>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="mt-auto flex flex-wrap gap-2">
        {item.trustStatus !== "TRUSTED" && (
          <>
            {item.trustStatus === "UNTRUSTED" && (
              <Button size="sm" variant="outline" onClick={() => void patch({ trustStatus: "UNDER_REVIEW" })}>
                <ShieldAlert aria-hidden="true" /> Start review
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void patch({ trustStatus: "TRUSTED" })}>
              <ShieldCheck aria-hidden="true" /> Mark reviewed and trusted
            </Button>
          </>
        )}
        {item.lifecycle === "DRAFT" && item.trustStatus === "TRUSTED" && (
          <Button size="sm" variant="outline" onClick={() => void patch({ lifecycle: "ACTIVE" })}>
            Activate
          </Button>
        )}
        {item.kind === "TEMPLATE" &&
          item.contentRef &&
          item.lifecycle === "ACTIVE" &&
          item.trustStatus === "TRUSTED" && (
            <Button size="sm" asChild>
              <Link
                to={`/projects/new?template=${item.id}`}
                aria-label={`Use template ${item.title} to start a project`}
              >
                <Rocket aria-hidden="true" /> Use template
              </Link>
            </Button>
          )}
        {item.lifecycle === "ACTIVE" && (
          <Button size="sm" variant="ghost" onClick={() => void patch({ lifecycle: "DEPRECATED" })}>
            Deprecate
          </Button>
        )}
      </div>
    </li>
  );
}

function CatalogForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    slug: "",
    title: "",
    description: "",
    kind: "TEMPLATE",
    category: "",
    technologies: "",
    tags: "",
    version: "0.1.0",
    sourceType: "AUTHORED",
    sourceReference: "",
    license: "Proprietary",
    ownership: "ASAA",
    dependencies: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const imported = form.sourceType === "IMPORTED";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const candidate = {
      ...form,
      technologies: csv(form.technologies),
      tags: csv(form.tags),
      sourceReference: form.sourceReference || undefined,
      dependencies: csv(form.dependencies).map((entry) => {
        const at = entry.lastIndexOf("@");
        return at > 0 ? { name: entry.slice(0, at), version: entry.slice(at + 1) } : { name: entry, version: "" };
      }),
    };
    const parsed = createCatalogItemSchema.safeParse(candidate);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setPending(true);
    try {
      await api("/catalog", { method: "POST", body: parsed.data });
      onCreated();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setMessage(error.message);
      } else setMessage("Could not register the item.");
    } finally {
      setPending(false);
    }
  }

  const dependencyError =
    errors.dependencies ?? Object.entries(errors).find(([key]) => key.startsWith("dependencies."))?.[1];
  return (
    <form noValidate onSubmit={submit} className="space-y-4" aria-label="Register catalog item">
      {message && <Alert tone="danger">{message}</Alert>}
      {imported && (
        <Alert tone="warning">
          Imported source is recorded as untrusted. It stays out of active use until you review and trust it.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" error={errors.title}>
          <Input
            value={form.title}
            maxLength={160}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="Slug" error={errors.slug} hint="Lowercase identifier, e.g. react-starter">
          <Input
            value={form.slug}
            maxLength={80}
            onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}
          />
        </Field>
        <Field label="Kind" error={errors.kind}>
          <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
            {CATALOG_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {humanize(kind)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category" error={errors.category}>
          <Input
            value={form.category}
            maxLength={80}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          />
        </Field>
        <Field label="Technologies" hint="Comma separated" error={errors.technologies}>
          <Input
            value={form.technologies}
            onChange={(event) => setForm({ ...form, technologies: event.target.value })}
          />
        </Field>
        <Field label="Tags" hint="Comma separated" error={errors.tags}>
          <Input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
        </Field>
        <Field label="Version" error={errors.version}>
          <Input value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} />
        </Field>
        <Field label="Source" error={errors.sourceType}>
          <Select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value })}>
            {SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanize(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Source reference"
          error={errors.sourceReference}
          hint={imported ? "Required for imports (repository URL or archive)" : "Optional"}
        >
          <Input
            value={form.sourceReference}
            maxLength={500}
            onChange={(event) => setForm({ ...form, sourceReference: event.target.value })}
          />
        </Field>
        <Field label="License" error={errors.license}>
          <Input
            value={form.license}
            maxLength={80}
            onChange={(event) => setForm({ ...form, license: event.target.value })}
          />
        </Field>
        <Field label="Ownership" error={errors.ownership}>
          <Input
            value={form.ownership}
            maxLength={120}
            onChange={(event) => setForm({ ...form, ownership: event.target.value })}
          />
        </Field>
        <Field label="Dependencies" hint="name@version, comma separated" error={dependencyError}>
          <Input
            value={form.dependencies}
            onChange={(event) => setForm({ ...form, dependencies: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Description" error={errors.description}>
        <Textarea
          value={form.description}
          maxLength={4000}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Register item"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
