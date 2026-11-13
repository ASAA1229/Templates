import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { createBrowserRouter, Link, Navigate, RouterProvider, useLocation, type RouteObject } from "react-router";
import { AppShell } from "@/components/AppShell";
import { EmptyState, LoadingState } from "@/components/common";
import { Button } from "@/components/ui";
import { AuditPage } from "@/features/audit/AuditPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { AccessRequestPage } from "@/features/auth/AccessRequestPage";
import { ActivateAccountPage } from "@/features/auth/ActivateAccountPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { AccessRequestsPage } from "@/features/security/AccessRequestsPage";
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ProjectDetailPage } from "@/features/projects/ProjectDetailPage";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { SecurityPage } from "@/features/security/SecurityPage";
import { TeamMembersPage } from "@/features/security/TeamMembersPage";
import { TemplateSubmissionsPage } from "@/features/templates/TemplateSubmissionsPage";
import { SearchPage } from "@/features/search/SearchPage";
import { AuthProvider, useAuth } from "@/lib/auth";

// Project initialization is loaded on demand to keep the initial bundle small.
const WorkspacePage = lazy(() =>
  import("@/features/workspace/WorkspacePage").then((module) => ({ default: module.WorkspacePage })),
);
const NewProjectWizard = lazy(() =>
  import("@/features/generation/NewProjectWizard").then((module) => ({ default: module.NewProjectWizard })),
);

const TITLES: [RegExp, string][] = [
  [/^\/$/, "Dashboard"],
  [/^\/projects\/new$/, "New project"],
  [/^\/projects\/[^/]+\/workspace$/, "Engineering workspace"],
  [/^\/projects\/[^/]+/, "Project"],
  [/^\/projects/, "Projects"],
  [/^\/catalog/, "Template catalog"],
  [/^\/search/, "Advanced search"],
  [/^\/audit/, "Audit log"],
  [/^\/security/, "Security"],
  [/^\/team/, "Team members"],
  [/^\/template-submissions/, "Template submissions"],
  [/^\/login/, "Sign in"],
  [/^\/reset-password/, "Reset password"],
];

/** Route guard: unauthenticated visitors go to sign-in and return afterwards. */
function RequireOwner({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "checking") {
    return (
      <div className="mx-auto max-w-md p-10">
        <LoadingState label="Checking your session" rows={1} />
      </div>
    );
  }
  if (status === "signed-out")
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Keeps the document title and focus in sync with navigation for screen-reader users. */
function RouteAnnouncer() {
  const location = useLocation();
  const firstRender = useRef(true);
  useEffect(() => {
    const title = TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] ?? "Not found";
    document.title = `${title} · ASAA Templates`;
    // Move focus only after in-app navigation; on first load the skip link stays first in tab order.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [location.pathname]);
  return null;
}

function NotFound() {
  return (
    <>
      <h1 className="sr-only">Not found</h1>
      <EmptyState
        title="Page not found"
        description="The page you asked for does not exist or you do not have access to it."
        action={
          <Button asChild>
            <Link to="/">Back to dashboard</Link>
          </Button>
        }
      />
    </>
  );
}

function Root({ children }: { children: ReactNode }) {
  return (
    <>
      <RouteAnnouncer />
      {children}
    </>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/request-access",
    element: (
      <Root>
        <AccessRequestPage />
      </Root>
    ),
  },
  {
    path: "/activate",
    element: (
      <Root>
        <ActivateAccountPage />
      </Root>
    ),
  },
  {
    path: "/login",
    element: (
      <Root>
        <LoginPage />
      </Root>
    ),
  },
  {
    path: "/reset-password",
    element: (
      <Root>
        <ResetPasswordPage />
      </Root>
    ),
  },
  {
    element: (
      <Root>
        <RequireOwner>
          <AppShell />
        </RequireOwner>
      </Root>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "projects", element: <ProjectsPage /> },
      {
        path: "projects/new",
        element: (
          <Suspense fallback={<LoadingState label="Loading project setup" />}>
            <NewProjectWizard />
          </Suspense>
        ),
      },
      {
        path: "projects/:projectId/workspace",
        element: (
          <Suspense fallback={<LoadingState label="Loading engineering workspace" />}>
            <WorkspacePage />
          </Suspense>
        ),
      },
      { path: "projects/:projectId", element: <ProjectDetailPage /> },
      { path: "catalog", element: <CatalogPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "audit", element: <AuditPage /> },
      { path: "security", element: <SecurityPage /> },
      { path: "team", element: <TeamMembersPage /> },
      { path: "access-requests", element: <AccessRequestsPage /> },
      { path: "template-submissions", element: <TemplateSubmissionsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
