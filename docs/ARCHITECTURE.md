# Architecture

**Product:** ASAA Templates Platform  
**Architecture style:** modular monolith  
**Decision baseline:** 2026-11-12

## 1. Product and system boundary

ASAA Templates is a private internal engineering and business-technology workspace. The first validated product slice focuses on reusable templates, project initialization, project/requirements management and controlled engineering workflows. Future business operations and multi-organization productization are architectural directions, not current release claims.

The repository is one deployable application composed of a web client, API, shared contracts and a PostgreSQL database. Keep domain boundaries explicit. Extract services only when workload, security, team ownership or deployment evidence justifies the operational cost.

## 2. Approved initial technology baseline

| Layer | Approved baseline |
|---|---|
| Web | React + Vite |
| Languages | TypeScript by default; JavaScript supported |
| API/runtime | Node.js + Express |
| Persistence | PostgreSQL + Prisma |
| UI | Tailwind CSS + shadcn/ui foundations |
| Shared contracts | TypeScript + Zod |

The repository currently pins Node 24.16.0 in `.nvmrc`. Package versions are pinned by workspace manifests and lockfile. This baseline does not mandate that every future module use the same database, language or framework; technology selection remains fit-for-purpose while preserving integration contracts and maintainability.

Not selected as organization-wide decisions: production hosting, deployment topology, CI/CD provider strategy, queue/event broker, object storage, monitoring vendor, AI provider or container platform. Evaluate free/local-first options and record material choices before adoption.

## 3. Logical architecture

1. **Experience:** application shell, navigation, dashboards, catalog, project builder, project workspace and administration.
2. **Identity and governance:** authentication, session lifecycle, authorization policies, approvals and audit.
3. **Project delivery:** projects, requirements, traceability, tasks, milestones and lifecycle.
4. **Catalog and reusable assets:** template metadata, manifests, package versions, components, design assets and dependencies.
5. **Configuration and generation:** project blueprints, declared inputs, compatibility validation, preview, generation and provenance.
6. **Engineering:** source workspace, Git operations, build/test execution, quality gates and artifacts.
7. **Delivery and operations:** environment profiles, release approvals, deployment, monitoring, incident response, backup and recovery.
8. **Integration adapters:** Git providers, CI systems, storage, databases, toolchains and optional approved AI/JARVIS capabilities.
9. **Future business domains:** CRM, sales, proposals, contracts, finance, HR, procurement, support, analytics and related operations.

Each domain owns its rules and authoritative data. Cross-domain interaction uses validated contracts and explicit service interfaces; avoid uncontrolled shared-table coupling.

## 4. Runtime and repository layout

- `apps/web`: single-page React application; feature-oriented modules; Vite development server on loopback port 5000 by default.
- `apps/api`: Express composition root and domain routers; API defaults to port 4000; Prisma schema and migrations; local template library.
- `packages/contracts`: shared request/response schemas and type contracts.
- `catalog`: machine-readable coverage registry.
- `docs`: canonical product and engineering documentation.

During local development, Vite proxies `/api` to the API so browser requests remain same-origin. The API can optionally serve the built SPA when `WEB_DIST_DIR` is configured.

## 5. Data and artifact boundaries

- PostgreSQL is the authoritative relational store for identity, projects, requirements, catalog metadata, audit and related application records.
- Prisma owns schema and migration history. Migrations are applied through the repository scripts; do not edit a deployed schema out of band.
- Template source packages, approved immutable template versions and generated projects are separate artifacts.
- Template manifests declare identity, version, files, inputs, dependencies, compatibility and provenance.
- Generated projects retain source-template/generator provenance but are independently editable and versioned.
- Generated output must be stored outside platform source and template-library directories.
- Local template packages are discovered from the configured library path; hidden pending submissions are not public catalog entries.
- Search/indexing, analytics and AI context are projections; authorization must be rechecked against authoritative data before returning or acting on results.

## 6. Template and project lifecycle

**Template lifecycle:** draft/import → static validation → security/license/provenance review → functional and compatibility checks → maintainer approval → immutable release → deprecation/archive.

**Project lifecycle:** requirements → blueprint/architecture selection → template composition or blank/import path → configuration/preview → generation → independent development → build/test/security evidence → release approval → deployment → monitoring/maintenance/rollback.

A generated project is never silently changed by a template update. Updates require explicit impact analysis, compatibility checks, user selection and a recovery path.

## 7. Blueprint and generator model

A versioned project blueprint describes project family, architecture profile, runtimes, languages, frameworks, package manager, database, APIs, infrastructure, operating systems, dependencies and supported capabilities as relevant.

Generator adapters declare their supported families, inputs, outputs, versions and compatibility. Unsupported combinations must fail clearly rather than produce incomplete output. Generator and blueprint versions are retained in provenance so output can be reproduced.

Initial project families include websites, web applications, e-commerce, backend services/APIs and full-stack applications. Mobile, desktop, enterprise, data/AI and DevOps families are expandable targets and must not be represented as complete until implemented and tested.

## 8. Identity and authorization architecture

The current identity foundation supports OWNER, ADMIN, DEVELOPER, TESTER and EMPLOYEE account roles, server-side permission checks, member administration and audit attribution. The OWNER is unique and retains ultimate authority. Project membership adds VIEWER and EDITOR resource roles without replacing organization-level account roles.

Project sharing is implemented on `new`: owners manage membership; VIEWER is read-only; EDITOR can write within the member's organization permissions. Project, requirement, workspace and generation access paths have been integrated with the centralized project-access helper, and list/search/dashboard scoping has been updated. This implementation is not yet fully verified: every project-linked route, background job, export, audit view and indirect lookup still requires endpoint-by-endpoint isolation tests. UI visibility is not a security boundary.

Employee access request, approval and one-time activation foundations exist. Owner/Admin-issued password reset is implemented with hashed, expiring, single-use tokens, rate limiting, audit and session revocation; its end-to-end behavior remains NEEDS TESTING. MFA policy, lifecycle edge cases, specialist roles and full cross-user/project isolation evidence remain open before general employee rollout.

## 9. Integration and AI boundaries

External tools are optional adapters with explicit capabilities, scoped credentials, health reporting, versioning, audit and revocation. The core platform must remain usable without external integrations.

JARVIS remains a separate product. Only explicitly approved chatbot, agent, monitoring or model-orchestration capabilities may be exposed through a dedicated adapter. Company agents require separate identities, memory, tools, permissions and audit. Personal JARVIS memory, device access and personal permissions are never exposed to company users. Paid AI is disabled until explicitly authorized.

## 10. Cross-cutting quality requirements

- Contract validation, typed API boundaries and standardized errors.
- Responsive accessible UI; WCAG 2.2 AA is the target baseline.
- Security and authorization checks at API and resource level.
- Correlation IDs, structured logs and audit events for sensitive actions.
- Reproducible setup, pinned dependencies and migration discipline.
- Unit, component, integration, API, E2E, accessibility, security, performance and recovery tests selected by risk.
- Background work uses bounded resources, timeouts, retries, cancellation, idempotency and observable failure states.
- Provider portability and data export are considered in storage and integration choices.
- No microservices, distributed infrastructure or paid dependencies without a concrete requirement and owner approval.

## 11. Architecture decisions and change control

The approved technology baseline above supersedes earlier exploratory/pending stack notes. Supporting technology decisions remain open until explicitly evaluated. A material architecture change records context, options, rationale, cost, security/privacy impact, migration/rollback plan and review trigger in this document or an ADR retained in the canonical architecture record.

Do not introduce a separate Markdown ADR collection. Keep the decision record concise and current here.


## Current status authority — 2026-11-13

Current implementation status, evidence, maturity scores, gap register and release decision are maintained in [PROJECT_STATUS.md](PROJECT_STATUS.md). This architecture record describes design boundaries and decisions, not acceptance status.


## Current candidate status — 2026-11-13

This document records architecture, not verification status. The active candidate is `15fdfe1b016d2f7997008dc68701b99e4220ce26` on `new`; PR #1 remains open/unmerged. CI #738 (`43419669158`) was in progress at last inspection and does not yet verify this candidate. Current implementation/testing distinctions and release gates are maintained in [PROJECT_STATUS.md](PROJECT_STATUS.md).



## Current candidate status — 2026-11-13

This document records architecture, not verification status. The active candidate is `15fdfe1b016d2f7997008dc68701b99e4220ce26` on `new`; PR #1 remains open/unmerged. CI #738 (`43419669158`) was in progress at last inspection and does not verify this candidate yet. Current implementation/testing distinctions and release gates are maintained in [PROJECT_STATUS.md](PROJECT_STATUS.md).
