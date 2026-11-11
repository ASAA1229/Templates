import { FolderKanban, LayoutDashboard, Library, LogOut, Menu, Search, ScrollText, ShieldCheck, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/catalog", label: "Template catalog", icon: Library },
  { to: "/audit", label: "Audit log", icon: ScrollText },
  { to: "/security", label: "Security", icon: ShieldCheck },
] as const;

interface SearchResult {
  id: string;
  type: "PROJECT" | "REQUIREMENT" | "CATALOG";
  title: string;
  subtitle: string;
  href: string;
}
interface SearchResponse {
  query: string;
  results: SearchResult[];
}

/** Small, permission-aware global search over projects, requirements and catalog. */
function GlobalSearch() {
  const id = useId();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const normalized = query.trim();

  useEffect(() => {
    if (normalized.length < 2) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api<SearchResponse>(`/search?q=${encodeURIComponent(normalized)}`)
        .then((response) => {
          if (active) {
            setResults(response.results);
            setSearched(true);
          }
        })
        .catch(() => {
          if (active) {
            setResults([]);
            setSearched(true);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [normalized]);

  function openResult(href: string) {
    setQuery("");
    setResults([]);
    setSearched(false);
    navigate(href);
  }

  return (
    <div className="relative min-w-0 w-full max-w-md">
      <label htmlFor={id} className="sr-only">Search projects, requirements and templates</label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              setResults([]);
            }
            if (event.key === "Enter" && results[0]) openResult(results[0].href);
          }}
          placeholder="Search projects, requirements, templates…"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={normalized.length >= 2}
          aria-controls={`${id}-results`}
          className="h-9 pl-9 pr-3"
        />
      </div>
      {normalized.length >= 2 && (
        <div
          id={`${id}-results`}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg"
        >
          {loading ? (
            <p className="px-3 py-4 text-sm text-muted-foreground" role="status">
              Searching…
            </p>
          ) : results.length ? (
            <ul className="space-y-1">
              {results.map((result) => (
                <li key={`${result.type}-${result.id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => openResult(result.href)}
                    className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="text-sm font-medium">{result.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {result.type.toLowerCase()} · {result.subtitle}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : searched ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No matching results.</p>
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">Type at least 2 characters.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Responsive application shell (US-B01, US-B02, US-B04). */
export function AppShell() {
  const { owner, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const nav = (
    <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1 p-3">
      {NAV_ITEMS.map(({ to, label, icon: Icon, ...rest }) => (
        <NavLink
          key={to}
          to={to}
          end={"end" in rest}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              isActive && "bg-sidebar-accent text-sidebar-foreground",
            )
          }
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex h-16 items-center gap-2 px-5 text-sidebar-foreground">
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
      >
        A
      </span>
      <span className="font-semibold">ASAA Templates</span>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="hidden bg-sidebar lg:flex lg:flex-col">
        {brand}
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside
            id="mobile-nav"
            className="relative flex h-full w-72 max-w-[85vw] flex-col bg-sidebar"
            aria-label="Menu"
          >
            <div className="flex items-center justify-between pr-3">
              {brand}
              <Button
                variant="ghost"
                size="icon"
                className="text-sidebar-foreground"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header
          className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6"
        >
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline" data-testid="owner-name">
              {owner?.displayName}
            </span>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut aria-hidden="true" /> Sign out
            </Button>
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
