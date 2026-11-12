# Product User Stories and Acceptance Criteria

**Product:** ASAA Templates Platform  
**Status:** Consolidated requirements backlog — individual story status remains evidence-based  
**Version:** 1.2  
**Date:** 2026-11-12

## 1. Backlog conventions

- **P0:** required for the first usable MVP, subject to dependency review.
- **P1:** important follow-on capability.
- **P2:** future/advanced capability.
- **Status:** all stories below are **Not Started** unless explicitly changed with implementation evidence.
- Each story includes observable acceptance criteria. Detailed test cases, API contracts and screen-level tasks will be expanded during implementation planning.
- The owner is the bootstrap administrator. The first internal rollout is intended for explicitly authorized ASAA management and employees; invitation and least-privilege role controls must be implemented and verified before enabling those accounts. External organizations remain future scope.
- **Cost constraint:** all stories must be implementable with ₹0 operating spend until the owner explicitly authorizes otherwise.

## 2. Epic A — Identity, ownership and access

### US-A01 — Owner sign-in (P0)
As the platform owner, I want secure authentication so that only authorized access is possible.
- Given an initialized platform, when valid owner credentials are supplied, then an authenticated session is created.
- Invalid credentials do not reveal whether a particular account exists.
- Passwords are never stored in plaintext; transport and session protections are applied.
- Login events and security-relevant failures are auditable without logging secrets.

### US-A02 — Session and account recovery (P0)
As the owner, I want controlled session and recovery management.
- Sessions expire according to documented policy and can be revoked.
- Recovery requires a verified, secure process.
- Sensitive session/device information is protected and auditable.

### US-A03 — MFA and future identity methods (P1)
As the owner, I want stronger authentication options.
- MFA can be enabled and recovery codes or equivalent recovery controls are documented.
- Passkeys and enterprise SSO remain modular future options.
- MFA enforcement can be configured without bypassing owner security policy.

### US-A04 — Policy-based authorization (P1)
As the owner, I want permissions to be enforced at module, action and resource level.
- Authorization is checked server-side for every protected operation.
- RBAC is supported initially; ABAC/ReBAC and contextual rules can be added through policy interfaces.
- Denied actions are safely reported and auditable.
- Tenant/resource isolation is designed before multi-organization rollout.

## 3. Epic B — Workspace, navigation and UI/UX

### US-B01 — Unified owner workspace (P0)
As the owner, I want a unified dashboard so that I can access active projects and important platform activity.
- Dashboard shows project status, recent activity and actionable alerts.
- Dashboard data respects access policies.
- Empty, loading, error and populated states are specified.

### US-B02 — Consistent navigation (P0)
As the owner, I want predictable navigation across modules.
- Navigation, routes, breadcrumbs and contextual actions are consistent.
- Unknown or unauthorized routes fail safely.
- Navigation supports keyboard operation and responsive layouts.

### US-B03 — Global search (P1)
As an authorized user, I want cross-module search.
- Search supports relevant project, template and knowledge records.
- Results are filtered by authorization.
- Filters and source references are available where relevant.

### US-B04 — Responsive accessible interface (P0)
As a user, I want the interface to work across desktop, tablet and mobile.
- Layout adapts to defined breakpoints and interaction modes.
- Keyboard navigation, focus visibility, labels and contrast are validated.
- WCAG 2.2 AA is the target; automated checks are supplemented by manual testing.

### US-B05 — Design system and component library (P0)
As a developer, I want reusable, documented UI components.
- Design tokens cover typography, spacing, color, borders and responsive behavior.
- Components document APIs, variants, themes, interaction states and accessibility behavior.
- Component tests and visual regression checks are available for critical components.
- Free/open-source foundations may be used, but components remain replaceable.

### US-B06 — Screen and workflow specifications (P0)
As the owner, I want implementation-ready screen definitions.
- Every MVP screen has a route, purpose, layout, user journey, data needs and permission rules.
- API dependencies and loading/empty/error/success states are documented.
- Acceptance criteria and responsive behavior are traceable to tests.

## 4. Epic C — Requirements and project management

### US-C01 — Create and manage projects (P0)
As the owner, I want to create and manage software projects.
- A project has a unique identifier, name, purpose, status, owner and timestamps.
- Project metadata can be updated with validation and audit history.
- Project records can be archived and recovered according to policy.

### US-C02 — Capture requirements (P0)
As the owner, I want structured requirements and user stories.
- Requirements support descriptions, priority, dependencies, acceptance criteria and status.
- Ambiguous or conflicting requirements can be flagged for review.
- Requirement changes are versioned and traceable.

### US-C03 — Manage tasks and milestones (P1)
As the owner, I want work decomposed into actionable tasks.
- Tasks support priority, status, estimates, dependencies and evidence.
- Blocked work and overdue milestones are visible.
- Future team assignment does not require redesigning the task model.

### US-C04 — Trace requirements to delivery (P0)
As the owner, I want requirements connected to implementation and verification.
- Requirements can link to tasks, code changes, tests, defects, documentation and releases.
- Missing verification evidence is visible.
- Reports distinguish planned, developed, built, tested and released states.

## 5. Epic D — Template catalog and reusable assets

### US-D01 — Browse and search catalog (P0)
As the owner, I want to discover reusable templates and assets.
- Catalog records support title, description, category, technology, tags, version and lifecycle status.
- Search and filters return relevant records.
- Only authorized/private assets are visible.

### US-D02 — Create and import template metadata (P0)
As the owner, I want to register templates and imported projects.
- Metadata is validated against a versioned schema.
- Source ownership, licensing, technology and dependencies are recorded.
- Imported source is treated as untrusted until scanned and reviewed.

### US-D03 — Categorize templates (P1)
As the owner, I want configurable classification.
- Categories can be organized by category, sector, division, business type and template.
- Tags and cross-category relationships are supported.
- Classification changes do not corrupt existing references.

### US-D04 — Manage template versions (P1)
As the owner, I want immutable template releases and history.
- Each release has a version, changelog, compatibility metadata and source reference.
- Older versions remain discoverable subject to retention policy.
- Rollback and comparison are available.

### US-D05 — Manage reusable components and assets (P1)
As the owner, I want shared components and design assets.
- Assets have ownership, license, version, dependencies and compatibility metadata.
- Reuse across projects is traceable.
- Updates include impact analysis and never silently alter generated projects.

## 6. Epic E — Project initialization and generation

### US-E01 — Start from a template (P0)
As the owner, I want to initialize a project from a selected template.
- The system validates template status, compatibility and required inputs.
- Generation creates a separate project output.
- The result includes source and version provenance.

### US-E02 — Start from scratch (P0)
As the owner, I want to create a project without a template.
- The wizard captures project type, requirements and initial technology choices.
- The generated structure follows approved conventions.
- Choices and generated files are reproducible.

### US-E03 — Import an existing project (P1)
As the owner, I want to import an existing repository or source package.
- Import scans structure, dependencies, secrets and licenses where tools are available.
- The original source is preserved.
- Findings are reported before any modification.

### US-E04 — Combine templates and assets (P1)
As the owner, I want to compose a project from multiple reusable assets.
- Dependencies and compatibility are checked before generation.
- Conflicts are reported with resolution options.
- Composition is recorded for reproducibility.

### US-E05 — Safe template update (P1)
As the owner, I want to update a generated project deliberately.
- Proposed changes are compared and impact is explained.
- Migration steps and backups are available where needed.
- No update is applied without explicit authorization.
- Rollback or recovery is documented and tested.

## 7. Epic F — Engineering workspace and source control

### US-F01 — Repository integration (P0)
As the owner, I want to connect project source control.
- Provider credentials are stored outside source control.
- Repository operations use scoped permissions.
- Branches, commits and pull requests can be linked to project work.

### US-F02 — Controlled branching and reviews (P1)
As the owner, I want protected integration and production branches.
- Branch naming and merge policies are documented.
- Required checks and reviews are enforced where supported.
- Direct production changes are restricted by policy.

### US-F03 — Reproducible development environment (P1)
As a developer, I want documented, repeatable setup.
- Runtime and tool versions are recorded.
- Setup can be validated from a clean environment.
- Local execution is supported before cloud dependencies are introduced.

### US-F04 — Technology adapters (P1)
As the owner, I want the platform to support multiple technology stacks.
- Project technology is detected or explicitly selected.
- Build, test and package adapters expose standardized results.
- Unsupported combinations fail clearly rather than silently.

## 8. Epic G — Build, test and quality engineering

### US-G01 — Reproducible build (P0)
As the owner, I want to build a project using recorded dependencies and configuration.
- Build inputs and tool versions are recorded.
- Build output and logs are retained according to policy.
- A successful build is labeled build-verified, not production-ready.

### US-G02 — Automated test execution (P0)
As the owner, I want relevant tests to run consistently.
- Unit and integration tests are supported for the MVP stack.
- Test results, duration, failures and evidence are recorded.
- Test execution can be repeated from a clean environment.

### US-G03 — Extensible testing ecosystem (P1)
As the owner, I want support for API, component, UI, E2E, regression, compatibility, accessibility, reliability and specialized tests.
- Test adapters select tools by technology and test type.
- Test suites can be scoped by change risk.
- Reports are consolidated without hiding individual failures.

### US-G04 — Security testing (P1)
As the owner, I want security checks integrated into delivery.
- SAST, SCA and secret scanning are included where supported.
- DAST, API, container, IaC and penetration testing are planned according to risk and environment.
- Findings include severity, affected component and remediation status.

### US-G05 — Performance testing (P1)
As the owner, I want performance risks identified before release.
- Baselines and workload assumptions are documented.
- Load, stress, spike and endurance tests can be executed where relevant.
- Regressions and resource bottlenecks are reported.

### US-G06 — Quality gates (P0)
As the owner, I want configurable release-readiness checks.
- Gates consider tests, defects, security, performance, accessibility, compatibility and required documentation.
- Exceptions require explicit authorization and audit.
- Release states are evidence-based and distinguish testing complete from production-ready.

### US-G07 — Test traceability and reports (P1)
As the owner, I want to trace requirements to test results.
- Requirements map to test cases and execution evidence.
- Reports show coverage, failures, defects and trends.
- Flaky tests are identified and cannot be silently counted as reliable passes.

## 9. Epic H — DevOps, deployment and operations

### US-H01 — Environment configuration (P0)
As the owner, I want separate environment profiles.
- Development and test configuration are separated at minimum.
- Staging and production profiles are defined without requiring paid infrastructure.
- Secrets are not stored in repository files.

### US-H02 — CI pipeline (P0)
As the owner, I want repeatable automated validation.
- Pipeline validates formatting, lint, type checks, build and selected tests.
- Pipeline results are linked to commits and project status.
- Tool selection respects the ₹0 limit.

### US-H03 — Release pipeline (P1)
As the owner, I want controlled packaging and release.
- Artifacts have version, checksum and source commit metadata.
- Quality gates execute before promotion.
- Approval and rollback steps are recorded.

### US-H04 — Deployment and rollback (P1)
As the owner, I want deployments to be verifiable and recoverable.
- Deployment strategy is selected based on application and infrastructure.
- Health checks and post-deployment smoke tests run.
- Rollback conditions and procedures are documented and verified.

### US-H05 — Observability (P1)
As the owner, I want visibility into application and pipeline health.
- Structured logs, metrics and relevant traces are available.
- Alerts identify actionable failures without exposing secrets.
- Incidents link to affected project, deployment and evidence.

### US-H06 — Backup and restore (P1)
As the owner, I want recoverable project and platform data.
- Backup scope, schedule, encryption and retention are defined.
- Integrity is verified.
- Restore procedures are tested and results recorded.

### US-H07 — Infrastructure as Code (P2)
As the owner, I want repeatable infrastructure definitions.
- Infrastructure configuration is version controlled.
- Plans are validated before application.
- Drift and destructive changes are surfaced for approval.

## 10. Epic I — Security, governance and resilience

### US-I01 — Secrets protection (P0)
As the owner, I want credentials protected.
- Secrets are excluded from Git and logs.
- Access is least-privilege and environment-scoped.
- Rotation and revocation procedures are documented.

### US-I02 — Audit trail (P0)
As the owner, I want important actions traceable.
- Administrative, generation, approval, integration and deployment actions record actor, time, target and outcome.
- Audit data is access-controlled and protected against ordinary modification.
- Sensitive values are redacted.

### US-I03 — Data isolation (P0 foundation)
As the owner, I want project and client data separated.
- Project boundaries and ownership are enforced.
- Cross-project access is explicit.
- Multi-tenant isolation is validated before external organizations are onboarded.

### US-I04 — Dependency and supply-chain controls (P1)
As the owner, I want dependencies and artifacts assessed.
- Lockfiles and reproducible versions are maintained.
- Vulnerability and license checks run.
- SBOM/provenance/signing capabilities are added where practical and free.
- Risky changes require approval.

### US-I05 — Resilience and recovery (P1)
As the owner, I want failures handled safely.
- Timeouts, retries, idempotency and safe failure behavior are defined.
- Backups and recovery objectives are documented.
- Destructive or high-risk remediation requires approval.

## 11. Epic J — AI and JARVIS integration

### US-J01 — Optional AI assistant (P1)
As the owner, I want an AI assistant for project-aware help.
- AI is optional and the platform remains usable without it.
- Context access is permission-scoped and source-aware.
- AI output is labeled as assistance and can be reviewed.

### US-J02 — Specialized agents (P1)
As the owner, I want specialized agents for defined tasks.
- Agents have unique identity, role, tools, permissions and lifecycle.
- Agent actions are logged and evaluated.
- Agent autonomy is configurable by risk.

### US-J03 — Monitoring bot (P1)
As the owner, I want an agent to summarize authorized monitoring signals.
- The bot reads only approved logs, metrics and events.
- Alerts include source evidence and confidence limitations.
- Remediation is approval-controlled.

### US-J04 — JARVIS integration boundary (P1)
As the owner, I want selected JARVIS capabilities available without merging the products.
- Integration uses explicit APIs/adapters and scoped credentials.
- Only chatbot, agents, monitoring, model orchestration and approved reusable modules are exposed.
- Personal JARVIS memory, private device access and personal capabilities remain inaccessible.
- Integration can be disabled without disabling the core platform.

### US-J05 — AI cost and privacy controls (P0 for any AI feature)
As the owner, I want AI usage to respect privacy and the zero-cost policy.
- Local/free options are preferred.
- External data sharing is disclosed and controlled.
- No paid model/API is invoked without explicit owner approval.
- Token/resource usage and agent actions are auditable.

## 12. Epic K — Future multi-organization platform

### US-K01 — Organization workspaces (P2)
As a future organization administrator, I want a separate workspace.
- Each organization has isolated users, projects, assets, configuration and audit records.
- Tenant context is enforced server-side.
- Cross-tenant access is denied and tested.

### US-K02 — Delegated administration (P2)
As the platform owner, I want to delegate limited administration.
- Roles and permissions are configurable.
- High-risk platform actions remain owner-controlled unless explicitly delegated.
- Delegation and revocation are auditable.

### US-K03 — Organization customization (P2)
As an organization administrator, I want configurable branding and workflows.
- Themes, modules, policies, templates, integrations and dashboards are configurable within platform limits.
- Customization does not compromise shared-core security.
- Upgrades include compatibility and migration checks.

## 13. Epic L — Future business operations

The following are future roadmap epics, not MVP commitments:
- CRM, lead and sales pipeline management.
- Proposal, quotation, pricing and contract lifecycle.
- Accounting, invoicing, payments, expense and financial reporting.
- Payroll, HR, recruitment, attendance, leave and workforce planning.
- Vendor, procurement, purchase order, inventory and asset management.
- Customer support, ticketing, SLA, maintenance and service management.
- Knowledge management, business process automation and cross-module BI.
- Legal/compliance, risk, continuity, strategy and partnership management.

Each future epic must receive its own detailed stories, jurisdiction-specific review where relevant, permissions, data model, integrations, acceptance criteria and test plan before implementation.

## 14. Global non-functional requirements

1. **Cost:** ₹0 until explicit owner approval; no hidden paid dependency.
2. **Security:** least privilege, secure defaults, secret protection, audit and threat-aware design.
3. **Privacy:** data minimization, controlled external processing and no personal JARVIS memory exposure.
4. **Reliability:** observable failures, safe retries, backups and tested recovery.
5. **Maintainability:** modular boundaries, documented contracts and automated quality checks.
6. **Portability:** provider adapters, exportability and reproducible local deployment.
7. **Accessibility:** WCAG 2.2 AA target for the platform UI.
8. **Performance:** measurable budgets defined during stack/MVP design, not arbitrary unverified targets.
9. **Traceability:** requirement → design → task → code → test → release evidence.
10. **Usability:** consistent responsive workflows and actionable error states.

## 15. Definition of Done

A story is Done only when:
- Acceptance criteria are met and reviewed.
- Relevant automated and manual tests pass with evidence.
- Security, accessibility, performance and compatibility checks appropriate to risk are complete.
- Documentation and operational notes are updated.
- No unresolved blocker or unapproved high-severity risk remains.
- Changes are reviewed and merged through the defined branch policy.
- Deployment/release state is recorded accurately.

A merged commit or successful build alone does not make a story Done or production-ready.


## 16. Approved implementation baseline and delivery mapping (2026-11-09)

The owner-approved implementation stack for the initial platform is:
- **Frontend:** React + Vite.
- **Languages:** TypeScript by default, with JavaScript supported.
- **Backend:** Node.js + Express.
- **Database/data access:** PostgreSQL + Prisma.
- **Styling/component foundation:** Tailwind CSS + shadcn/ui.

This is a technology decision, not evidence that implementation has started. All existing stories retain their current **Not Started** status until code and acceptance evidence exist.

### Initial implementation mapping

| Implementation slice | Related stories | Expected evidence before marking Done |
|---|---|---|
| Repository/app foundation and conventions | US-F03, US-F04 | Reproducible local setup, pinned runtimes/dependencies, documented module boundaries |
| Frontend shell and design foundation | US-B01, US-B02, US-B04, US-B05, US-B06 | Responsive routes, accessible component states, component tests and screen specifications |
| Backend/API foundation | US-A01, US-A02, US-C01, US-C02 | Validated API contracts, server-side authorization, secure session behavior and API tests |
| PostgreSQL/Prisma data foundation | US-C01, US-C02, US-C04, US-I02, US-I03 | Reviewed schema, migrations, constraints, audit and project-boundary tests |
| Owner authentication vertical slice | US-A01, US-A02, US-I01 | Secure sign-in/session/recovery implementation with negative-path and security tests |
| Project management vertical slice | US-C01, US-C02, US-C04, US-B01 | Create/read/update project and requirements flows with traceability and tests |
| Template catalog foundation | US-D01, US-D02 | Validated catalog metadata, search/filter behavior and untrusted-import safeguards |

### Sequencing and controls
1. Complete architecture decisions and repository conventions.
2. Scaffold the React/Vite frontend and Node/Express backend without introducing unnecessary services.
3. Configure PostgreSQL and Prisma for local development; commit no credentials or environment secrets.
4. Establish shared UI tokens/components and API validation/error conventions.
5. Deliver owner authentication and project management as a tested vertical slice.
6. Proceed to catalog and project initialization only after the foundation passes its gates.

The exact test libraries and CI/deployment products remain undecided. Select only free/local-first options and record them in separate ADRs before adoption. Do not add paid APIs, hosting, runners or subscriptions without explicit owner approval.

### Story status policy
- Documentation and scaffolding alone do not complete a story.
- A story moves to In Progress only when implementation work has actually begun.
- Development Complete requires all acceptance criteria implemented and reviewed.
- Build Verified, Testing Complete and Production Ready are separate evidence-backed states.
- Never infer testing completion from a successful build or a merged commit.


## 17. Expanded experience, collaboration and enterprise capability backlog (Q12–Q31)

The following stories translate the completed requirements discovery into implementable backlog items. They are additive to Epics A–L. Unless implementation evidence is linked in the project status register, each new story is **Not Started**. Priority is provisional and indicates sequencing, not a promise that all stories belong in the MVP.

### Epic M — Collaboration and shared workspaces

#### US-M01 — Real-time collaborative editing (P1)
As an authorized team member, I want to collaborate on supported templates, documents and project artifacts.
- Concurrent edits are synchronized with conflict detection/resolution appropriate to the artifact.
- Presence and active collaborators are visible where permitted.
- Offline edits are queued safely and conflicts are surfaced before overwrite.
- Collaboration access is checked against resource and workspace permissions.

#### US-M02 — Comments, annotations and review (P1)
As a contributor or reviewer, I want contextual comments and annotations.
- Comments can be attached to supported resources or specific versions/locations.
- Threads support replies, resolution, mentions and moderation according to policy.
- Review decisions and requested changes are recorded with actor and timestamp.
- Notifications link to the authorized resource and relevant context.

#### US-M03 — Assignments and team coordination (P1)
As a project or team member, I want to assign work and track ownership.
- Tasks and review actions support assignee, due date, priority and status.
- Team and cross-module assignments preserve a single traceable work item.
- Reassignment, completion and overdue transitions are auditable.

#### US-M04 — Presence and team communication (P2)
As an authorized collaborator, I want presence and contextual communication.
- Presence can be enabled or disabled by policy and user preference.
- Team chat and resource-linked discussions enforce membership and retention policies.
- Communication is not exposed across tenants or unauthorized workspaces.

#### US-M05 — Controlled external collaboration (P2)
As an administrator, I want external collaboration only when explicitly enabled.
- External identities receive scoped, expiring access to selected resources.
- Download, copy, export and re-sharing controls are policy-driven.
- External access, changes and revocation are audited.
- External collaboration is disabled by default until separately approved.

### Epic N — Notification and attention management

#### US-N01 — Central notification center (P1)
As a user, I want one place to review relevant notifications.
- Notifications are searchable/filterable by source, time, category, priority and read state.
- Each notification links to an authorized destination.
- Read, unread, archived and acknowledged states are supported.

#### US-N02 — Multi-channel notification delivery (P1)
As a user, I want policy-approved notifications across supported channels.
- In-app delivery is supported first; email, mobile push and other channels are adapter-based.
- User preferences and organization policies are both evaluated.
- Delivery attempts, outcomes and provider errors are recorded without exposing secrets.
- Channel availability and consent are explicit; unsupported channels fail visibly.

#### US-N03 — Notification rules and preferences (P1)
As a user or administrator, I want configurable notification behavior.
- Users can configure allowed categories, channels, frequency and quiet periods.
- Organization policies can mandate critical security/operational notifications.
- User preferences cannot suppress mandatory policy alerts.
- Rule changes are versioned and auditable.

#### US-N04 — Priority, grouping and deduplication (P1)
As a user, I want related notifications grouped and ranked.
- Severity and priority have documented definitions.
- Duplicate or correlated events can be grouped without losing source-event evidence.
- Grouping and ranking are explainable and reversible to the underlying events.
- Critical alerts are not hidden by low-priority aggregation.

#### US-N05 — Escalation, reminders and acknowledgment (P1)
As an owner or responsible operator, I want unacknowledged alerts escalated.
- Policies define escalation targets, timing, reminders and terminal conditions.
- Acknowledgment records actor and timestamp but does not falsely mark an incident resolved.
- Escalation loops are bounded, idempotent and observable.

#### US-N06 — AI-assisted notification prioritization (P2)
As a user, I want AI to summarize and prioritize relevant notifications.
- AI prioritization is advisory and exposes the signals/reasons used.
- Mandatory alert policies take precedence over AI ranking.
- AI cannot dismiss, suppress or resolve critical alerts autonomously.
- Inputs are permission-filtered and AI actions are audited.

### Epic O — Universal search and command center

#### US-O01 — Permission-aware global search (P1)
**Implementation status:** API and UI slice committed; automated verification pending.
As an authorized user, I want to search across enabled modules.
- Search indexes approved entity types and metadata across modules.
- Results are filtered by current organization, workspace and resource permissions.
- Access is revalidated when opening a result; index contents are not an authorization authority.
- Indexing failures, stale results and unavailable sources are visible.

#### US-O02 — Advanced search and saved queries (P1)
**Implementation status:** Implemented on `new`; automated validation and review pending.
As a user, I want filters, facets and reusable searches.
- Search supports module-specific filters, facets, sorting and pagination.
- Users can save, rename, update and delete personal searches.
- Shared searches require explicit sharing permissions and retain access checks; sharing is not implemented and remains deferred.

Implementation evidence:
- API: `apps/api/src/modules/search/search.ts` supports module filters, facets, sorting, pagination and owner-scoped saved-search CRUD.
- Persistence: `SavedSearch` Prisma model and migration `20261112100000_saved_searches`.
- UI: `apps/web/src/features/search/SearchPage.tsx`, registered at `/search` and linked from global search.
- Tests: `apps/api/test/search.test.ts` and `apps/web/src/test/search-page.test.tsx`.
- Current state: implementation is committed to `new`; CI, runtime behavior, pagination edge cases and accessibility review must pass before this story is marked Done.

#### US-O03 — Natural-language and semantic search (P2)
As a user, I want to describe what I am looking for in ordinary language.
- Search can interpret intent and semantic similarity while preserving source references.
- Results identify the source module and relevant matching context.
- AI-derived summaries are distinguished from authoritative source data.
- Search remains usable through keyword/filter paths without AI.

#### US-O04 — Command palette and contextual actions (P1)
As a user, I want to navigate and invoke permitted actions quickly.
- Keyboard-accessible command palette supports navigation and registered actions.
- Actions are filtered by role, resource state and policy.
- Destructive or high-impact commands require confirmation and/or approval.
- Commands record actor, target, parameters safe for audit and outcome.

#### US-O05 — Approved AI task orchestration (P2)
As an authorized user, I want to request multi-step tasks in natural language.
- AI proposes a plan, identifies tools and previews material changes before execution.
- Every step re-checks authorization and policy at execution time.
- Sensitive actions require human approval; failed steps and partial completion are reported.
- Idempotency, cancellation, rollback/compensation and action audit are defined.

#### US-O06 — Search analytics and relevance governance (P2)
As a platform administrator, I want to improve search quality safely.
- Search latency, no-result rates, relevance feedback and index freshness are measured.
- Analytics are aggregated and access-controlled.
- Personal/sensitive query content is minimized and retained according to policy.

### Epic P — Dashboards and workspace personalization

#### US-P01 — Role and organization dashboards (P1)
As a user, I want a dashboard appropriate to my role and workspace.
- Dashboard defaults can vary by role, department, team, project and organization.
- All widgets enforce the viewer's data permissions.
- Missing or unavailable data is clearly distinguished from zero values.

#### US-P02 — Personal dashboard builder (P1)
As a user, I want to customize my dashboard.
- Users can add, remove, resize, rearrange and configure approved widgets.
- Layouts can be saved as personal profiles and restored.
- Organization policies can restrict unsupported widgets or sharing.

#### US-P03 — Shared team and project dashboards (P1)
As a team or project lead, I want to share governed dashboards.
- Dashboard ownership, audience and permissions are explicit.
- Shared dashboards do not grant access to underlying data.
- Changes, publication and access are auditable.

#### US-P04 — Executive and operational dashboards (P1)
As an authorized leader or operator, I want strategic and live operational views.
- Executive metrics and operational health use governed metric definitions.
- Operational widgets show freshness and source status.
- Sensitive cross-department metrics require explicit authorization.

#### US-P05 — Live widgets, refresh and scheduled snapshots (P2)
As a user, I want current data and scheduled dashboard snapshots.
- Refresh intervals are bounded and configurable by policy.
- Stale, delayed and failed data sources are identified.
- Scheduled snapshots record generation time, data window and recipients.

#### US-P06 — AI-assisted dashboard creation (P2)
As an authorized user, I want dashboards generated from a natural-language request.
- AI proposes widgets, data sources, filters and metric definitions before saving.
- All data-source permissions are enforced.
- Users can edit, save, compare and discard generated layouts.
- AI-generated interpretations are labeled and traceable.

### Epic Q — Reporting and business intelligence

#### US-Q01 — Standard and custom report builder (P1)
As an authorized analyst, I want standard reports and configurable reports.
- Reports support governed fields, filters, grouping, sorting and calculations.
- Report definitions are versioned and reusable.
- Query scope and export permissions are checked server-side.

#### US-Q02 — Interactive visualization and drill-down (P1)
As a user, I want to explore metrics visually.
- Supported visualizations include charts, tables, timelines and other suitable views.
- Drill-down preserves filter context and permission checks.
- Accessible alternatives are provided for visual-only information.

#### US-Q03 — Cross-module analytics and metric definitions (P2)
As an authorized analyst, I want governed analysis across modules.
- Metric definitions have an owner, formula, scope and version.
- Cross-module joins respect data ownership and access boundaries.
- Data lineage identifies source modules and transformations.

#### US-Q04 — Historical, trend and predictive analysis (P2)
As a decision-maker, I want to compare historical performance and examine forecasts.
- Historical periods and comparison windows are explicit.
- Forecasts show assumptions, confidence/uncertainty and source freshness.
- Predictions are not presented as confirmed facts or automatic decisions.

#### US-Q05 — AI insights and anomaly explanations (P2)
As a decision-maker, I want concise explanations of significant patterns.
- AI insights cite underlying metrics and source records available to the viewer.
- Anomalies include reason, confidence limitations and investigation links.
- AI does not silently alter source data or business records.

#### US-Q06 — Scheduled reports and export (P1)
As an authorized user, I want reports delivered or exported in approved formats.
- Scheduling supports timezone, recurrence, recipient authorization and cancellation.
- Export formats are selected based on supported and secure implementation.
- Export events are audited; sensitive exports can require approval.

### Epic R — Dynamic forms and workflow interaction

#### US-R01 — Visual form builder and reusable schemas (P1)
As an administrator or authorized designer, I want to create reusable forms.
- Form schemas define fields, types, labels, help text, validation and version.
- Published schema versions are immutable; edits create a new version.
- Forms can be reused across permitted modules without bypassing domain validation.

#### US-R02 — Conditional and multi-step forms (P1)
As a user, I want forms to adapt to my answers and workflow.
- Conditional visibility and branching rules are deterministic and testable.
- Multi-step forms preserve progress and clearly show validation errors.
- Users can review entered data before final submission.

#### US-R03 — Drafts, autosave and recovery (P1)
As a user, I want unfinished forms preserved.
- Drafts are saved safely with clear save status and conflict handling.
- Recovery is scoped to the user/resource permissions.
- Sensitive draft data follows encryption, retention and deletion policies.

#### US-R04 — Validation, bulk entry and imports (P1)
As an operator, I want accurate individual and bulk data entry.
- Client-side convenience validation is repeated server-side.
- Imports provide preview, row-level errors and explicit commit confirmation.
- Partial import behavior is defined; duplicate handling is deterministic.

#### US-R05 — Workflow approvals and signatures (P1)
As an authorized approver, I want form submissions connected to controlled workflows.
- Workflow states, approvers, delegation, rejection and resubmission are explicit.
- Acknowledgments/signatures record identity, intent, time and artifact version.
- Legally binding signature requirements receive separate legal and provider review before adoption.

#### US-R06 — AI-assisted form completion (P2)
As a user, I want help extracting or suggesting form values.
- Suggestions identify source documents and confidence/uncertainty.
- Users review and confirm extracted values before submission.
- AI cannot approve a submission or invent missing authoritative data.

### Epic S — Documents, files and digital assets

#### US-S01 — Central file and asset repository (P1)
As an authorized user, I want a unified repository for documents and media.
- Files are organized by workspace/project and configurable folders/tags.
- Metadata records owner, type, version, source, classification and timestamps.
- Storage adapters preserve portability and access control.

#### US-S02 — Preview and supported editing integrations (P1)
As a user, I want to preview supported content and edit through approved tools.
- Supported formats and preview limitations are documented.
- Previews do not bypass source-file permissions.
- External editing integrations are explicit, revocable and audited.

#### US-S03 — Version history and comparison (P1)
As a user, I want revisions and change history.
- New versions retain immutable provenance and checksums where appropriate.
- Users can compare and restore eligible versions with permission checks.
- Restore operations create auditable events rather than erasing history.

#### US-S04 — Secure sharing and access policies (P1)
As an owner or administrator, I want controlled file sharing.
- Access supports least privilege, expiry and revocation.
- Public links are disabled unless explicitly authorized.
- Download, export, preview and re-sharing can be governed separately.

#### US-S05 — Retention, archival and secure disposal (P2)
As an administrator, I want files managed through their lifecycle.
- Retention classes and legal holds are policy-driven.
- Archival and deletion produce auditable evidence.
- Deletion propagates to indexes, previews and replicas according to documented policy.

#### US-S06 — AI document intelligence and security scanning (P2)
As an authorized user, I want documents classified and searchable.
- OCR, extraction and summaries retain source references.
- Uploaded files are treated as untrusted and scanned before processing.
- AI processing respects data classification and approved processing boundaries.
- Malware/integrity failures quarantine files and prevent unsafe use.

### Epic T — Activity, audit and operational history

#### US-T01 — Unified and entity-specific activity feeds (P1)
As a user, I want to inspect activity across the platform and on individual resources.
- Events have a consistent schema with actor, action, target, time and outcome.
- Feed visibility is permission-filtered.
- Entity timelines correlate relevant project, template, document and workflow events.

#### US-T02 — Change comparison and event correlation (P1)
As a reviewer, I want to understand what changed and how events relate.
- Supported changes show before/after values with sensitive fields redacted.
- Correlation IDs link related events across modules and background jobs.
- Missing correlation or partial history is clearly indicated.

#### US-T03 — Security and administrative audit protection (P0 foundation)
As the platform owner, I want privileged actions recorded and protected.
- Authentication, authorization, policy, role, export, approval and administrative events are recorded.
- Ordinary application users cannot alter audit history.
- Audit access, export, retention and integrity verification are controlled and tested.

#### US-T04 — Real-time activity and AI summaries (P2)
As an authorized operator, I want live activity and concise summaries.
- Live streams enforce access and support reconnect/replay behavior.
- AI summaries link back to source events and label uncertainty.
- AI cannot modify or suppress authoritative audit records.

#### US-T05 — Audit export, retention and archival (P1)
As an auditor or owner, I want controlled evidence retrieval.
- Exports preserve event identity, timestamps, provenance and integrity metadata.
- Retention and archival policies are configurable within governance limits.
- Legal hold and deletion exceptions are auditable.

### Epic U — Organization navigation and workspace management

#### US-U01 — Organization hierarchy and workspace switcher (P1)
As an authorized user, I want to navigate the organization structure and workspaces.
- Hierarchy supports parent organization, subsidiary, business unit, division, department, team and project.
- Workspace switching updates context and revalidates permissions.
- Shared-service access is explicit and does not imply unrestricted cross-workspace access.

#### US-U02 — Unified navigation, breadcrumbs and context preservation (P1)
As a user, I want predictable navigation without losing work.
- Routes, breadcrumbs, deep links and parent navigation are consistent.
- Filters, drafts and permitted view state are preserved when navigating.
- Unauthorized or deleted destinations fail safely.

#### US-U03 — Application launcher, tabs and shortcuts (P1)
As a user, I want quick access to enabled modules and work areas.
- Launcher lists only enabled and authorized applications.
- Favorites, recent items, multiple tabs and saved workspace layouts are supported.
- Keyboard operation and responsive layouts are available.

#### US-U04 — Adaptive and AI-assisted navigation (P2)
As a user, I want navigation suited to device and task.
- Layout adapts to screen size and interaction mode.
- AI navigation suggestions are advisory and permission-aware.
- Command execution follows the same authorization and approval controls as direct navigation.

### Epic V — Onboarding, learning and in-app assistance

#### US-V01 — Personalized onboarding and product tours (P1)
As a new user, I want onboarding suited to my role and workspace.
- Onboarding journeys are role-aware and can be resumed or skipped where policy permits.
- Tours explain navigation and relevant workflows without changing production data.
- Completion and dismissal preferences are stored appropriately.

#### US-V02 — Contextual guidance and guided tasks (P1)
As a user, I want help at the point of need.
- Tooltips, contextual help and guided walkthroughs are maintained with the relevant feature version.
- Guided tasks use safe sample data or explicit confirmation before real changes.
- Users can exit and resume supported walkthroughs.

#### US-V03 — Searchable knowledge and learning center (P1)
As a user, I want documentation and training in one discoverable location.
- Guides, FAQs, videos and troubleshooting content are searchable and versioned.
- Content has an owner, review date and applicable product version.
- Access follows content classification and role permissions.

#### US-V04 — AI support assistant and issue reporting (P2)
As a user, I want help understanding platform behavior and reporting problems.
- AI answers are grounded in authorized, maintained knowledge sources and link to references.
- The assistant distinguishes known documentation from inference and escalates unresolved questions.
- Support requests include consented diagnostics with secrets and sensitive data redacted.

#### US-V05 — Feature discovery, training progress and feedback (P2)
As a user or administrator, I want to learn new capabilities and improve the platform.
- Release guidance is targeted by role and enabled modules.
- Learning paths, assessments and completion records are supported where enabled.
- Feedback is categorized, traceable and reviewed; it is not treated as an automatic approval to change policy.

### Epic W — Design-system, device and accessibility maturity

#### US-W01 — Governed theme and token system (P1)
As an administrator or designer, I want consistent organization branding and themes.
- Tokens cover color, typography, spacing, elevation, borders, motion and responsive behavior.
- Light/dark/system and approved theme variants are supported.
- Organization governance can constrain user-level customization.

#### US-W02 — Versioned component and page-schema registry (P1)
As a developer, I want reusable components with compatibility guarantees.
- Components expose documented variants, slots, states and accessibility contracts.
- Packages and page schemas are versioned with dependency/compatibility metadata.
- Breaking changes require migration guidance and controlled release.

#### US-W03 — Advanced data interaction components (P1)
As a user, I want suitable views for different work types.
- Tables, cards, boards, timelines, charts, trees, maps and relationship views are selected by use case.
- Keyboard, screen-reader and responsive alternatives are provided.
- Large datasets use pagination/virtualization or other measured performance techniques.

#### US-W04 — Device-aware and offline-capable experience (P2)
As a user, I want consistent workflows across supported devices.
- Touch, mouse, keyboard and stylus interactions are supported where relevant.
- Offline-capable functions identify local versus server state and synchronization status.
- Conflict resolution and sensitive local-data protection are documented and tested.

#### US-W05 — Accessibility, localization and RTL validation (P1)
As a user, I want an accessible and localized interface.
- WCAG 2.2 AA is the baseline; AAA is adopted where practical.
- Automated and manual keyboard, screen-reader, contrast and reduced-motion tests are performed.
- UI and content support localization, locale-aware formats and RTL layouts where enabled.

#### US-W06 — Visual regression and design quality gates (P1)
As a designer or developer, I want visual changes validated.
- Critical components and screens have stable visual regression coverage.
- Baselines are reviewed and updated intentionally.
- Responsive viewports, themes and accessibility states are included in the validation matrix.

## 18. Requirements-to-story traceability

| Discovery questions | Backlog coverage |
|---|---|
| Q1–Q5: product ecosystem, actors, workspaces, extensibility and progressive scope | Epics A–L; M–V; POC Sections 19–23 |
| Q6–Q9: organization hierarchy, human/AI governance, lifecycle and information architecture | A, C, I, J, K, M, N, O, T, U |
| Q10–Q11: channels and unified experience | B, U, W; platform channel architecture |
| Q12–Q19: design language, themes, personalization, interactions, components, accessibility and devices | B, P, U, W |
| Q20–Q21: catalog discovery and customization | D, E, W; existing template-library requirements |
| Q22: collaboration | M |
| Q23: notifications | N |
| Q24: search and command center | O |
| Q25: dashboards | P |
| Q26: reporting and BI | Q |
| Q27: forms and workflows | R |
| Q28: files and assets | S |
| Q29: activity and audit history | T |
| Q30: navigation and workspaces | U |
| Q31: onboarding and assistance | V |

## 19. Priority and implementation sequencing notes

- Existing P0 stories remain candidates for the first usable internal vertical slice and must be dependency-reviewed.
- New P0 foundation: US-T03 audit protection is a prerequisite for privileged and cross-module operations.
- New P1 stories establish the first governed versions of collaboration, notifications, search, dashboards, reports, forms, files, navigation, onboarding and design-system maturity. They should be sequenced by MVP value and dependencies rather than implemented all at once.
- P2 stories include advanced AI, prediction, broad external collaboration, offline/native expansion and advanced learning/analytics capabilities.
- The owner must approve any change to the ₹0 operating-cost constraint. A capability that requires paid hosting, messaging, storage, AI or identity services remains blocked until an approved free/local-first alternative or explicit spending authorization exists.
- All stories require explicit implementation links and test evidence before status changes. The expanded backlog does not imply that these capabilities currently exist.

## 20. Story status and change control

The current repository contains an implemented platform foundation and an initial template demo batch; this does not automatically complete the new experience stories or all earlier stories. Maintain per-story status using the project status register and evidence links. Do not bulk-mark stories complete based on documentation, UI appearance, a successful build or an unverified claim.

The requirements discovery questionnaire is closed at Q31. Any future change should be recorded as a versioned requirement/change request with impact on architecture, scope, priorities, cost, security, testing and delivery.


### Search implementation evidence — 2026-11-11

- API module: apps/api/src/modules/search/search.ts.
- API composition: apps/api/src/app.ts mounts /search.
- UI: apps/web/src/components/AppShell.tsx adds debounced global search and result navigation.
- API tests: apps/api/test/search.test.ts cover cross-domain results, query validation and authentication.
- Implementation commits: ae22a81, 69ac914, 90684b0, 90551f0, 0c65ae0, 3ee0501, 34f174b and 1c08aee.
- Current status: committed; automated validation is pending. US-O01 is not complete until acceptance criteria and test evidence are verified. US-O02 remains partial.


## 21. Objective gap-closure backlog — 2026-11-12

This epic translates the agreed product objective into implementation-ready work. It closes gaps found by comparing the objective and POC with the current new branch source tree, Prisma model, API modules, UI features and template packages. These stories are Not Started unless later updated with implementation and verification evidence. They supplement existing stories and do not replace or duplicate their broader scope.

### Epic X — Complete the reusable software-project platform

#### US-X01 — Template validation and certification pipeline (P0)
As the platform owner, I want every template to pass repeatable quality checks before approval so that generated projects are safe, usable and trustworthy.
- Validate manifest schema, file inventory, paths, placeholders, dependencies, license/provenance metadata and content digest through the actual library loader.
- Validate generated output for unresolved placeholders, missing required files, unsafe paths, unexpected files and reproducibility.
- Run applicable install/build, functional, link, responsive, accessibility and security checks in an isolated test workspace.
- Render previews at representative desktop, tablet and mobile viewports; record results and evidence per template version.
- A template cannot become trusted/active for generation until mandatory checks and an authorized review pass.
- Reports identify failures and affected template versions; fixes require a new reviewed version or explicit revalidation.
- The initial 25 demo packages are all included in the first certification run; a static source review alone is not certification.

Related stories: US-D02, US-D04, US-G03, US-G04, US-G06, US-G07, US-I04.

#### US-X02 — Multi-stack project blueprints and generator adapters (P0)
As a developer, I want templates to represent complete software project types and technology stacks so that the platform can initialize more than static websites.
- Versioned blueprints identify project family, architecture profile, runtimes, languages, frameworks, package managers, databases, APIs, infrastructure and supported operating systems where relevant.
- Initial supported families are web applications, websites, e-commerce, backend services/APIs and full-stack applications; the architecture must allow mobile, desktop, enterprise, data/AI and DevOps project families to be added through adapters.
- Generator adapters have explicit capabilities, inputs, outputs, dependency rules, compatibility and version contracts.
- A generated project includes the required source structure, configuration, dependencies, scripts, tests and documentation declared by its blueprint.
- Incompatible or unsupported combinations are rejected with actionable explanations; the platform must not silently generate incomplete projects.
- Generator and blueprint versions are recorded in provenance so output can be reproduced.

Related stories: US-D03, US-E01, US-E02, US-F04, US-G01.

#### US-X03 — Template authoring, packaging and release workspace (P0)
As an authorized template maintainer, I want to create and maintain templates inside the platform so that the reusable library can grow without manual repository-only edits.
- Create a template from a blank package, duplicate an existing version, or import a source package/repository.
- Edit manifest metadata, source files, assets, inputs, dependencies, documentation and compatibility declarations.
- Validate continuously and show actionable errors before a package can be submitted for review.
- Support draft, review, approved/released, deprecated and archived lifecycle transitions with actor, timestamp and evidence.
- Released versions are immutable; edits create a new version with changelog and compatibility information.
- Imported content remains untrusted until provenance, licensing, security and functional review pass.
- Developers and testers can submit a successfully developed project as a candidate reusable template, with source-project and contributor attribution, customer-permission/IP-rights attestations, and secret scanning; submissions remain isolated in a pending-review area and never become selectable templates until an authorized maintainer approves them.
- Capture excludes repository metadata, generated provenance, dependency/build/cache folders, environment files and private-key files; unsafe paths, symlinks, oversized content and detected high-confidence credentials block submission.
- Approval promotes the exact submitted package into the immutable versioned library and records the reviewer and source submission in the audit trail; later edits require a new version.
- Only authorized maintainers can publish or approve versions; every consequential action is audited.

Related stories: US-D02, US-D04, US-D05, US-T03.

#### US-X04 — Configurable project builder and live preview (P0)
As a project creator, I want to configure a generated project at the appropriate level of detail so that the output matches its requirements before generation.
- Support guided/no-code configuration, structured low-code options and full-code/advanced configuration without forcing every user into one mode.
- Configure project identity, branding, themes, modules/features, pages/components, technology profile, integrations and environment-specific settings when supported by the blueprint.
- Build configuration controls dynamically from validated schemas and declared dependencies; show required, optional, conditional and incompatible options.
- Preview the configured result before generation, including supported responsive viewports and representative states.
- Save and reuse approved configuration profiles; compare configuration changes and show their impact.
- Validate all configuration on the server; never expose secrets in previews, URLs, logs or generated client-side code.

Related stories: US-E01, US-E04, US-D05, US-R01, US-W01, US-W02.

#### US-X05 — Isolated build and test execution engine (P0)
As a developer or QA engineer, I want to run project builds and tests through controlled execution jobs so that generated projects can be verified safely and consistently.
- Execute jobs in isolated, disposable workspaces/runners rather than executing arbitrary project code inside the API process or trusted application host.
- Select approved toolchain adapters and pinned versions from the project blueprint; deny unsupported or unapproved executables.
- Apply time, memory, CPU, disk, network and output limits; secrets and credentials are scoped, masked and unavailable by default.
- Support queued, running, succeeded, failed, cancelled and timed-out states with safe retry and idempotency rules.
- Capture structured logs, test reports, exit codes, artifact references and provenance, with access controlled by project permissions.
- Provide cancellation, cleanup and failure diagnostics; verify that one job cannot read or modify another project's files.
- Build/test results update project evidence but never automatically mark a project production-ready.

Related stories: US-G01, US-G02, US-G03, US-G04, US-G06, US-I01, US-I03.

#### US-X06 — Generated-project export and repository provisioning (P0)
As a project owner, I want to take generated source code into an independent delivery destination so that the project can be developed and delivered outside the Templates platform.
- Export a generated project as a complete ZIP with directory structure, required files, documentation and provenance; verify archive integrity with a checksum.
- Allow local folder access and approved remote repository provisioning through provider adapters.
- Before creating or pushing to a remote repository, show destination, visibility, owner, branch and files to be published and require explicit authorization.
- Never publish secrets, local environment files, generated credentials or restricted assets.
- Preserve source-template ID/version/digest and generator/configuration provenance in the project.
- Generated projects remain independent; future template updates require the explicit migration workflow in US-E05.
- Failed exports or repository operations are recoverable and auditable.

Related stories: US-E01, US-F01, US-F02, US-H03, US-I01.

#### US-X07 — Internal employee and management access (P0)
As the platform owner, I want to grant platform access to authorized ASAA management and employees so that the platform can be used internally without becoming public.
- Preserve a secure owner bootstrap account and ultimate owner authority.
- Support explicit invitation, activation, suspension, deactivation and recovery for internal users.
- Provide least-privilege role profiles for management/administration, project management, development, design, QA and DevOps; permissions are checked server-side at module, action and resource level.
- Project, template, asset, audit, integration and generated-output access is restricted by assigned permissions and ownership.
- Role changes, invitations, access denials and account lifecycle actions are audited.
- No anonymous, public-marketplace or external-organization access is enabled by this story.
- Employee access must not be enabled until role enforcement, session controls, audit coverage and access-isolation tests pass.

Related stories: US-A01, US-A02, US-A03, US-A04, US-I02, US-I03, US-M03, US-T03.

#### US-X08 — Governed integration connector registry (P1)
As a platform administrator, I want integrations managed through replaceable connectors so that projects can use development and delivery tools without hard-coding provider dependencies.
- Define a connector contract for authentication, capabilities, configuration, health, operations, errors, versioning and revocation.
- Prioritize local Git and GitHub repository workflows, Jenkins CI, file/artifact storage and supported database/toolchain integrations.
- Store credentials securely outside source control, scope permissions to the minimum required and support rotation/revocation.
- Show connection status and actionable failures; audit configuration changes and consequential provider actions.
- Integrations remain optional and the core platform remains usable without them.
- Use free/local-first configurations; no paid provider or service is activated without explicit owner approval.

Related stories: US-F01, US-F04, US-H02, US-H03, US-J04.

#### US-X09 — Reusable component, design-system and asset composition (P1)
As a designer or developer, I want reusable components and assets to be discoverable and composable so that projects share approved building blocks.
- Register UI components, page sections, design tokens/themes, API modules, workflows, documentation and other reusable engineering assets.
- Record owner, source, license, version, dependencies, compatibility, security status and supported project families.
- Support search, preview, documentation, dependency resolution and controlled release.
- Compose multiple compatible assets into a project blueprint and detect version conflicts, duplicate resources and incompatible dependencies before generation.
- Pin exact asset versions and produce a reproducible composition manifest.
- Updates never silently change generated projects; impact analysis and explicit migration are required.

Related stories: US-D05, US-E04, US-E05, US-W01, US-W02.

#### US-X10 — Online project source workspace (P1)
As a developer, I want to inspect and work with generated project files through a project workspace so that development does not depend only on generation and external Git commands.
- Provide a permission-aware file tree and source/document preview for generated project files.
- Support safe file editing, save/reload, diff against the last committed state and clear unsaved-change handling.
- Keep project boundaries and canonical output paths enforced on every file operation.
- Integrate with repository status, commit history and branches without bypassing configured branch policy.
- Any terminal, build or test execution uses US-X05's isolated execution engine; the web/API process must not expose an unrestricted shell.
- Provide a clear hand-off to external IDEs and local development when a full online IDE is not available.

Related stories: US-F01, US-F02, US-F03, US-G01.

#### US-X11 — End-to-end delivery and operations lifecycle (P1)
As a project owner or DevOps engineer, I want one traceable delivery lifecycle from validation through operations so that a project can be released and maintained responsibly.
- Model development, build verification, testing, security review, release candidate, approval, deployment, post-deployment verification, maintenance and rollback as distinct states.
- Support separate local/development/test/staging/production environment profiles without mixing secrets or data.
- Connect CI/CD runs, artifacts, approvals, deployments and smoke-test results to the project and release.
- Require explicit authorization for production or client deployment; no automatic publication or paid infrastructure.
- Capture structured operational logs, health/metrics, actionable alerts, incidents and deployment history.
- Provide backup, integrity verification, restore testing and documented recovery objectives for platform and project data.
- Failed health checks or deployment gates block promotion and expose a tested recovery/rollback path.

Related stories: US-H01, US-H02, US-H03, US-H04, US-H05, US-H06, US-I05, US-T01, US-T02.

#### US-X12 — Expandable sector and technology coverage (P1)
As a platform owner, I want template coverage to grow through a governed taxonomy and coverage plan so that the library can support the range of ASAA projects rather than remain limited to the first demo batch.
- Maintain expandable sector, business-type, technical-division and organizational-function taxonomies without hard-coded template-count limits.
- Track planned, drafted, validated, approved and missing coverage by sector, project family and technology profile.
- Prioritize new packages using actual ASAA project demand and reuse value, not arbitrary equal counts.
- Every new package follows US-X01 certification and US-X03 authoring/release governance.
- Report coverage honestly; a registered taxonomy entry is not counted as a completed template.

Related stories: US-D03, US-D04, US-X01, US-X02.

## 22. First implementation order for the objective

The following order is the initial execution queue. It is dependency-based; it does not mean all P0 stories must be completed before any P1 work begins.

1. **Stabilize and certify the current baseline:** finish CI/E2E/accessibility validation and run the actual loader → approval → preview → generation → integrity verification path for all 25 initial packages (US-X01).
2. **Generalize the generator:** define versioned project-family blueprints and adapter contracts beyond static HTML (US-X02).
3. **Build the template authoring lifecycle:** create, edit, import, validate, version, review and release packages in the platform (US-X03).
4. **Build project configuration and preview:** guided, low-code and advanced configuration with responsive preview (US-X04).
5. **Build safe execution:** isolated build/test jobs and evidence capture (US-X05).
6. **Complete project hand-off:** ZIP export and approved remote repository provisioning (US-X06).
7. **Enable internal access:** employee/management invitations, roles and isolation after security gates pass (US-X07).
8. **Add integration connectors and reusable composition:** GitHub/Jenkins/storage/tool adapters and governed component assets (US-X08, US-X09).
9. **Add online source workspace and delivery operations:** safe source editing, CI/CD, release, deployment, monitoring and recovery (US-X10, US-X11).
10. **Expand coverage by demand:** progressively populate sectors, business types and technology families (US-X12).

Do not divert into P2 enterprise tenancy, public marketplace, native clients, paid AI or broad business-operation modules before the core software-project lifecycle works end to end.

