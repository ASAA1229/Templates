import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
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
} from "@/components/ui";
import { api } from "@/lib/api";

type SearchType = "PROJECT" | "REQUIREMENT" | "CATALOG";
type ProjectStatus = "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED";
type RequirementStatus = "DRAFT" | "READY" | "IN_DEVELOPMENT" | "DEVELOPED" | "BUILT" | "TESTED" | "RELEASED";

interface SearchResult {
  id: string;
  type: SearchType;
  title: string;
  subtitle: string;
  href: string;
}

interface SearchFilters {
  types: SearchType[];
  projectStatus?: ProjectStatus;
  requirementStatus?: RequirementStatus;
  catalogCategory?: string;
  sortBy: "updatedAt" | "title";
  sortOrder: "asc" | "desc";
  pageSize: number;
}

interface SearchResponse {
  query: string;
  filters: SearchFilters;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  truncated: boolean;
  facets: {
    types: { value: SearchType; count: number }[];
    statuses: string[];
    categories: string[];
  };
  results: SearchResult[];
}

interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: SearchFilters;
}

const TYPE_OPTIONS: { value: "ALL" | SearchType; label: string }[] = [
  { value: "ALL", label: "All modules" },
  { value: "PROJECT", label: "Projects" },
  { value: "REQUIREMENT", label: "Requirements" },
  { value: "CATALOG", label: "Catalog" },
];

function toFilters(params: URLSearchParams): SearchFilters {
  const rawType = params.get("types");
  const types = rawType
    ? rawType.split(",").filter((value): value is SearchType => ["PROJECT", "REQUIREMENT", "CATALOG"].includes(value))
    : (["PROJECT", "REQUIREMENT", "CATALOG"] as SearchType[]);

  return {
    types,
    ...(params.get("projectStatus")
      ? { projectStatus: params.get("projectStatus") as ProjectStatus }
      : {}),
    ...(params.get("requirementStatus")
      ? { requirementStatus: params.get("requirementStatus") as RequirementStatus }
      : {}),
    ...(params.get("catalogCategory") ? { catalogCategory: params.get("catalogCategory")! } : {}),
    sortBy: params.get("sortBy") === "title" ? "title" : "updatedAt",
    sortOrder: params.get("sortOrder") === "asc" ? "asc" : "desc",
    pageSize: Number(params.get("pageSize") ?? 10),
  };
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsKey = searchParams.toString();
  const initialFilters = useMemo(() => toFilters(new URLSearchParams(paramsKey)), [paramsKey]);
  const [query, setQuery] = useState(new URLSearchParams(paramsKey).get("q") ?? "");
  const [type, setType] = useState<"ALL" | SearchType>(
    initialFilters.types.length === 1 ? initialFilters.types[0]! : "ALL",
  );
  const [projectStatus, setProjectStatus] = useState<string>(initialFilters.projectStatus ?? "");
  const [requirementStatus, setRequirementStatus] = useState<string>(initialFilters.requirementStatus ?? "");
  const [catalogCategory, setCatalogCategory] = useState(initialFilters.catalogCategory ?? "");
  const [sortBy, setSortBy] = useState<SearchFilters["sortBy"]>(initialFilters.sortBy);
  const [sortOrder, setSortOrder] = useState<SearchFilters["sortOrder"]>(initialFilters.sortOrder);
  const [pageSize, setPageSize] = useState(String(initialFilters.pageSize));
  const [data, setData] = useState<SearchResponse | null>(null);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [saveName, setSaveName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedError, setSavedError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ searches: SavedSearch[] }>("/search/saved")
      .then((response) => setSaved(response.searches))
      .catch(() => setSavedError("Saved searches could not be loaded."));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(paramsKey);
    const term = params.get("q")?.trim() ?? "";
    setQuery(term);
    if (term.length < 2) {
      setData(null);
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<SearchResponse>("/search?" + params.toString(), { signal: controller.signal })
      .then((response) => setData(response))
      .catch((reason: unknown) => {
        if ((reason as Error).name !== "AbortError") {
          setData(null);
          setError((reason as Error).message || "Search could not be completed.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [paramsKey]);

  function makeParams(nextPage = 1) {
    const params = new URLSearchParams();
    params.set("q", query.trim());
    if (type !== "ALL") params.set("types", type);
    if (projectStatus && (type === "ALL" || type === "PROJECT")) {
      params.set("projectStatus", projectStatus);
    }
    if (requirementStatus && (type === "ALL" || type === "REQUIREMENT")) {
      params.set("requirementStatus", requirementStatus);
    }
    if (catalogCategory.trim() && (type === "ALL" || type === "CATALOG")) {
      params.set("catalogCategory", catalogCategory.trim());
    }
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    params.set("page", String(nextPage));
    params.set("pageSize", pageSize);
    return params;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim().length < 2) {
      setError("Enter at least two characters to search.");
      return;
    }
    setSearchParams(makeParams());
  }

  function applySaved(item: SavedSearch) {
    setQuery(item.query);
    setType(item.filters.types.length === 1 ? item.filters.types[0]! : "ALL");
    setProjectStatus(item.filters.projectStatus ?? "");
    setRequirementStatus(item.filters.requirementStatus ?? "");
    setCatalogCategory(item.filters.catalogCategory ?? "");
    setSortBy(item.filters.sortBy);
    setSortOrder(item.filters.sortOrder);
    setPageSize(String(item.filters.pageSize));

    const params = new URLSearchParams();
    params.set("q", item.query);
    if (item.filters.types.length !== 3) params.set("types", item.filters.types.join(","));
    if (item.filters.projectStatus) params.set("projectStatus", item.filters.projectStatus);
    if (item.filters.requirementStatus) params.set("requirementStatus", item.filters.requirementStatus);
    if (item.filters.catalogCategory) params.set("catalogCategory", item.filters.catalogCategory);
    params.set("sortBy", item.filters.sortBy);
    params.set("sortOrder", item.filters.sortOrder);
    params.set("pageSize", String(item.filters.pageSize));
    setSearchParams(params);
  }

  async function saveCurrentSearch() {
    if (!data || !saveName.trim()) return;
    setSaving(true);
    setSavedError("");
    const filters: SearchFilters = {
      types: type === "ALL" ? ["PROJECT", "REQUIREMENT", "CATALOG"] : [type],
      ...(projectStatus ? { projectStatus: projectStatus as ProjectStatus } : {}),
      ...(requirementStatus ? { requirementStatus: requirementStatus as RequirementStatus } : {}),
      ...(catalogCategory.trim() ? { catalogCategory: catalogCategory.trim() } : {}),
      sortBy,
      sortOrder,
      pageSize: Number(pageSize),
    };

    try {
      const response = await api<{ search: SavedSearch }>("/search/saved", {
        method: "POST",
        body: { name: saveName.trim(), query: data.query, filters },
      });
      setSaved((current) => [response.search, ...current]);
      setSaveName("");
    } catch (reason) {
      setSavedError((reason as Error).message || "Saved search could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function renameSaved(item: SavedSearch) {
    const nextName = window.prompt("Rename saved search", item.name)?.trim();
    if (!nextName || nextName === item.name) return;

    try {
      const response = await api<{ search: SavedSearch }>("/search/saved/" + item.id, {
        method: "PATCH",
        body: { name: nextName, query: item.query, filters: item.filters },
      });
      setSaved((current) => current.map((entry) => (entry.id === item.id ? response.search : entry)));
      setSavedError("");
    } catch (reason) {
      setSavedError((reason as Error).message || "Saved search could not be renamed.");
    }
  }

  async function deleteSaved(item: SavedSearch) {
    if (!window.confirm(`Delete saved search "${item.name}"?`)) return;

    try {
      await api<void>("/search/saved/" + item.id, { method: "DELETE" });
      setSaved((current) => current.filter((entry) => entry.id !== item.id));
      setSavedError("");
    } catch (reason) {
      setSavedError((reason as Error).message || "Saved search could not be deleted.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="text-sm font-medium text-primary">Discovery</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Advanced search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search projects, requirements and approved catalog metadata with owner-scoped filters.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Search criteria</CardTitle>
          <CardDescription>
            Filters are applied on the server. Opening a result still uses the destination's normal authorization checks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="advanced-query">Search terms</Label>
              <Input
                id="advanced-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                minLength={2}
                maxLength={80}
                placeholder="Search projects, requirements or templates"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="search-type">Module</Label>
                <Select
                  id="search-type"
                  value={type}
                  onChange={(event) => setType(event.target.value as "ALL" | SearchType)}
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-status">Project status</Label>
                <Select id="project-status" value={projectStatus} onChange={(event) => setProjectStatus(event.target.value)}>
                  <option value="">Any status</option>
                  <option value="PLANNING">Planning</option>
                  <option value="ACTIVE">Active</option>
                  <option value="ON_HOLD">On hold</option>
                  <option value="COMPLETED">Completed</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="requirement-status">Requirement status</Label>
                <Select
                  id="requirement-status"
                  value={requirementStatus}
                  onChange={(event) => setRequirementStatus(event.target.value)}
                >
                  <option value="">Any status</option>
                  {["DRAFT", "READY", "IN_DEVELOPMENT", "DEVELOPED", "BUILT", "TESTED", "RELEASED"].map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="catalog-category">Catalog category</Label>
                <Input
                  id="catalog-category"
                  value={catalogCategory}
                  onChange={(event) => setCatalogCategory(event.target.value)}
                  maxLength={80}
                  placeholder="e.g. Website"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sort-by">Sort by</Label>
                <Select id="sort-by" value={sortBy} onChange={(event) => setSortBy(event.target.value as SearchFilters["sortBy"])}>
                  <option value="updatedAt">Recently updated</option>
                  <option value="title">Title</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sort-order">Sort direction</Label>
                <Select
                  id="sort-order"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as SearchFilters["sortOrder"])}
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={loading}>
                Search
              </Button>
              <Label htmlFor="page-size" className="text-muted-foreground">
                Results per page
              </Label>
              <Select
                id="page-size"
                className="w-24"
                value={pageSize}
                onChange={(event) => setPageSize(event.target.value)}
              >
                {[10, 20, 50].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
          </form>
        </CardContent>
      </Card>

      {savedError && <Alert tone="danger">{savedError}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Saved searches</CardTitle>
          <CardDescription>Personal to this owner account; they are never shared automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {saved.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved searches yet.</p>
          ) : (
            saved.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    "{item.query}" · {item.filters.types.join(", ")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => applySaved(item)}>
                    Load
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void renameSaved(item)}>
                    Rename
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void deleteSaved(item)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Searching…
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {data && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Results</CardTitle>
                <CardDescription>
                  {data.total} matching records for "{data.query}"
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.facets.types.map((facet) => (
                  <Badge key={facet.value}>
                    {facet.value.toLowerCase()}: {facet.count}
                  </Badge>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.facets.statuses.length > 0 && (
              <p className="text-xs text-muted-foreground">Statuses: {data.facets.statuses.join(" · ")}</p>
            )}
            {data.facets.categories.length > 0 && (
              <p className="text-xs text-muted-foreground">Categories: {data.facets.categories.join(" · ")}</p>
            )}
            {data.truncated && (
              <Alert tone="warning">
                The result set reached the current search cap. Narrow the filters to see more precise results.
              </Alert>
            )}
            {data.results.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">No results match these filters.</p>
            ) : (
              <ul className="divide-y">
                {data.results.map((item) => (
                  <li key={item.type + item.id} className="py-3">
                    <Link to={item.href} className="font-medium text-primary hover:underline">
                      {item.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.type.toLowerCase()} · {item.subtitle}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Input
                aria-label="Name this search"
                className="max-w-xs"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                maxLength={100}
                placeholder="Name this search"
              />
              <Button
                variant="secondary"
                disabled={!saveName.trim() || saving}
                onClick={() => void saveCurrentSearch()}
              >
                {saving ? "Saving…" : "Save search"}
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">Page {data.page}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => setSearchParams(makeParams(data.page - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!data.hasMore}
                onClick={() => setSearchParams(makeParams(data.page + 1))}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!data && !loading && !error && (
        <p className="text-sm text-muted-foreground">Enter a search term to explore your workspace.</p>
      )}
    </div>
  );
}
