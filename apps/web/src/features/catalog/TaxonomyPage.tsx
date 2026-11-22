import type { CatalogItemView, TaxonomyTermView } from "@asaa/contracts";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ErrorState, Field, LoadingState, PageHeader, StatusBadge } from "@/components/common";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useResource } from "@/lib/hooks";

type Taxonomy = { terms: TaxonomyTermView[]; unmanagedCategories: string[]; unsectoredItems: number };
type Member = { id: string; displayName: string; isActive: boolean };

/** Catalogue taxonomy and sector administration (D3.6, D3.7). Everyone can read; management can change. */
export function TaxonomyPage() {
  const { owner } = useAuth();
  const manage = owner?.role === "OWNER" || owner?.role === "ADMIN";
  const taxonomy = useResource<Taxonomy>("/catalog/taxonomy");
  const [members, setMembers] = useState<Member[]>([]);
  const [items, setItems] = useState<CatalogItemView[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    kind: "SECTOR",
    key: "",
    label: "",
    description: "",
    parentKey: "",
    stewardId: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [assignSector, setAssignSector] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const loadSupport = useCallback(async () => {
    if (!manage) return;
    try {
      const [people, catalog] = await Promise.all([
        api<{ members: Member[] }>("/auth/members"),
        api<{ items: CatalogItemView[] }>("/catalog"),
      ]);
      setMembers(people.members.filter((member) => member.isActive));
      setItems(catalog.items);
    } catch {
      // Stewards and bulk assignment are optional; the term list still works without them.
    }
  }, [manage]);

  useEffect(() => {
    void loadSupport();
  }, [loadSupport]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    setMessage("");
    setFieldErrors({});
    try {
      await action();
      setMessage(done);
      taxonomy.reload();
      void loadSupport();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else setError("Action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (taxonomy.state === "loading") return <LoadingState label="Loading taxonomy" />;
  if (taxonomy.state === "error") return <ErrorState error={taxonomy.error} onRetry={taxonomy.reload} />;
  const { terms, unmanagedCategories, unsectoredItems } = taxonomy.data;
  const sectors = terms.filter((term) => term.kind === "SECTOR");
  const stewardName = (id: string | null) => members.find((member) => member.id === id)?.displayName;

  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        api("/catalog/taxonomy", {
          method: "POST",
          body: {
            kind: form.kind,
            key: form.key,
            label: form.label,
            description: form.description,
            parentKey: form.parentKey || null,
            stewardId: form.stewardId || null,
          },
        }).then(() => setForm({ kind: form.kind, key: "", label: "", description: "", parentKey: "", stewardId: "" })),
      "Term created.",
    );
  };

  const section = (kind: "SECTOR" | "CATEGORY", title: string) => {
    const rows = terms.filter((term) => term.kind === kind);
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">None defined yet.</p>
          ) : (
            <ul className="divide-y" aria-label={title}>
              {rows.map((term) => (
                <li key={term.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {term.label} <span className="font-normal text-muted-foreground">({term.key})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {term.itemCount} item{term.itemCount === 1 ? "" : "s"} ({term.activeItemCount} active)
                      {term.parentKey ? ` · under ${term.parentKey}` : ""}
                      {term.stewardName ? ` · steward ${term.stewardName}` : ""}
                    </p>
                    {term.description && <p className="text-xs">{term.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!term.active && <Badge tone="warning">Inactive</Badge>}
                    {manage && (
                      <>
                        <Select
                          aria-label={`Steward for ${term.label}`}
                          className="h-9 w-44"
                          value={term.stewardId ?? ""}
                          disabled={busy}
                          onChange={(event) =>
                            void run(
                              () =>
                                api(`/catalog/taxonomy/${term.id}`, {
                                  method: "PATCH",
                                  body: { stewardId: event.target.value || null, expectedVersion: term.rowVersion },
                                }),
                              "Steward updated.",
                            )
                          }
                        >
                          <option value="">No steward</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.displayName}
                            </option>
                          ))}
                          {term.stewardId && !stewardName(term.stewardId) && (
                            <option value={term.stewardId}>{term.stewardName ?? "Former member"}</option>
                          )}
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                api(`/catalog/taxonomy/${term.id}`, {
                                  method: "PATCH",
                                  body: { active: !term.active, expectedVersion: term.rowVersion },
                                }),
                              term.active ? "Term deactivated." : "Term activated.",
                            )
                          }
                        >
                          {term.active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || term.itemCount > 0}
                          aria-label={`Delete ${term.label}`}
                          onClick={() =>
                            void run(() => api(`/catalog/taxonomy/${term.id}`, { method: "DELETE" }), "Term deleted.")
                          }
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      <PageHeader
        title="Catalogue taxonomy"
        description="Managed categories and business sectors with stewards. Sectors organise templates by the part of the business they serve."
        breadcrumbs={[
          { label: "Dashboard", to: "/" },
          { label: "Template catalog", to: "/catalog" },
          { label: "Taxonomy" },
        ]}
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
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {section("SECTOR", "Sectors")}
          {section("CATEGORY", "Categories")}
          {unmanagedCategories.length > 0 && (
            <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {unmanagedCategories.length} categor{unmanagedCategories.length === 1 ? "y is" : "ies are"} used by
                catalogue items but not managed: {unmanagedCategories.join(", ")}.
              </span>
              {manage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api("/catalog/taxonomy/adopt-categories", { method: "POST" }), "Categories adopted.")
                  }
                >
                  Adopt them
                </Button>
              )}
            </Alert>
          )}
        </div>
        {manage && (
          <div className="space-y-6">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>New term</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={create} className="space-y-3" noValidate>
                  <Field label="Kind">
                    <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
                      <option value="SECTOR">Sector</option>
                      <option value="CATEGORY">Category</option>
                    </Select>
                  </Field>
                  <Field label="Key" error={fieldErrors.key}>
                    <Input value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} />
                  </Field>
                  <Field label="Label" error={fieldErrors.label}>
                    <Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
                  </Field>
                  <Field label="Description" error={fieldErrors.description}>
                    <Input
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                    />
                  </Field>
                  <Field label="Parent" error={fieldErrors.parentKey}>
                    <Select
                      value={form.parentKey}
                      onChange={(event) => setForm({ ...form, parentKey: event.target.value })}
                    >
                      <option value="">None</option>
                      {terms
                        .filter((term) => term.kind === form.kind)
                        .map((term) => (
                          <option key={term.id} value={term.key}>
                            {term.label}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label="Steward" error={fieldErrors.stewardId}>
                    <Select
                      value={form.stewardId}
                      onChange={(event) => setForm({ ...form, stewardId: event.target.value })}
                    >
                      <option value="">None</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button type="submit" disabled={busy}>
                    Create term
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Assign sector</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{unsectoredItems} item(s) have no sector.</p>
                <Select
                  aria-label="Sector to assign"
                  value={assignSector}
                  onChange={(event) => setAssignSector(event.target.value)}
                >
                  <option value="">No sector (cross-sector)</option>
                  {sectors
                    .filter((sector) => sector.active)
                    .map((sector) => (
                      <option key={sector.id} value={sector.key}>
                        {sector.label}
                      </option>
                    ))}
                </Select>
                <ul className="max-h-56 space-y-1 overflow-auto text-sm" aria-label="Catalogue items">
                  {items.map((item) => (
                    <li key={item.id}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={picked.has(item.id)}
                          onChange={(event) =>
                            setPicked((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              return next;
                            })
                          }
                        />
                        <span className="truncate">{item.title}</span>
                        {item.sector && <StatusBadge value={item.sector} />}
                      </label>
                    </li>
                  ))}
                </ul>
                <Button
                  disabled={busy || picked.size === 0}
                  onClick={() =>
                    void run(
                      () =>
                        api("/catalog/taxonomy/assign-sector", {
                          method: "POST",
                          body: { sector: assignSector || null, itemIds: [...picked] },
                        }).then(() => setPicked(new Set())),
                      "Sector assigned.",
                    )
                  }
                >
                  Assign to {picked.size} item{picked.size === 1 ? "" : "s"}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
