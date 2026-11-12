import { Search } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
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
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const normalized = query.trim();
  const isOpen = normalized.length >= 2;

  useEffect(() => {
    if (!isOpen) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      setFailed(false);
      setActiveIndex(-1);
      return;
    }

    let active = true;
    setResults([]);
    setLoading(false);
    setSearched(false);
    setFailed(false);
    setActiveIndex(-1);

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
          setFailed(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, normalized]);

  function closeSearch() {
    setQuery("");
    setResults([]);
    setSearched(false);
    setFailed(false);
    setActiveIndex(-1);
  }

  function openResult(href: string) {
    closeSearch();
    navigate(href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeSearch();
      return;
    }

    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current >= results.length - 1 ? 0 : current + 1));
      return;
    }

    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
      return;
    }

    if (event.key === "Enter" && results.length > 0) {
      event.preventDefault();
      const selected = results[activeIndex >= 0 ? activeIndex : 0];
      openResult(selected.href);
    }
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
          onKeyDown={handleKeyDown}
          placeholder="Search projects, requirements, templates…"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen && results.length > 0 ? id + "-results" : undefined}
          aria-activedescendant={activeIndex >= 0 ? id + "-option-" + activeIndex : undefined}
          className="h-9 pl-9 pr-3"
        />
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg">
          {loading && (
            <p className="px-3 py-4 text-sm text-muted-foreground" role="status">
              Searching…
            </p>
          )}
          {failed && (
            <p className="px-3 py-4 text-sm text-muted-foreground" role="status">
              Search is unavailable. Try again.
            </p>
          )}
          {searched && !loading && !failed && results.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground" role="status">
              No matching results.
            </p>
          )}
          {results.length > 0 && (
            <div id={id + "-results"} role="listbox" aria-label="Search results" className="space-y-1">
              {results.map((result, index) => (
                <div
                  key={result.type + "-" + result.id}
                  id={id + "-option-" + index}
                  role="option"
                  aria-selected={activeIndex === index}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => openResult(result.href)}
                  className="flex w-full cursor-pointer flex-col rounded-md px-3 py-2 text-left hover:bg-accent aria-selected:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="text-sm font-medium">{result.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {result.type.toLowerCase()} · {result.subtitle}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
