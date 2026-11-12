import { FolderKanban, LayoutDashboard, Library, LogOut, Menu, ScrollText, Search, ShieldCheck, Upload, X } from "lucide-react";
import { GlobalSearch } from "./GlobalSearch";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/catalog", label: "Template catalog", icon: Library },
  { to: "/template-submissions", label: "Template submissions", icon: Upload },
  { to: "/search", label: "Advanced search", icon: Search },
  { to: "/audit", label: "Audit log", icon: ScrollText },
  { to: "/security", label: "Security", icon: ShieldCheck },
] as const;

/** Responsive application shell (US-B01, US-B02, US-B04): sidebar ≥ lg, drawer below. */
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
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
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
