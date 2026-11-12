import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import { Input } from "@/components/ui";
import { api } from "@/lib/api";

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

/** Debounced, permission-aware search across the current platform domains. */
export function GlobalSearch() {
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
      api<SearchResponse>("/search?q=" + encodeURIComponent(normalized))
        .then((response) => {
          if (!active) return;
          setResults(response.results);
          setSearched(true);
        })
        .catch(() => {
          if (!active) return;
          setResults([]);
          setSearched(true);
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
      <label htmlFor={id} className="sr-only">
        Search projects, requirements and templates
      </label>
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
            if (event.key === "Enter" && results[0]) {
              openResult(results[0].href);
            }
          }}
          placeholder="Search projects, requirements, templates…"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={normalized.length >= 2}
          aria-controls={id + "-results"}
          className="h-9 pl-9 pr-3"
        />
      </div>

      {normalized.length >= 2 && (
        <div
          id={id + "-results"}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg"
        >
          {loading ? (
            <p className="px-3 py-4 text-sm text-muted-foreground" role="status">
              Searching…
            </p>
          ) : results.length > 0 ? (
            <ul className="space-y-1">
              {results.map((result) => (
                <li key={result.type + "-" + result.id}>
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
