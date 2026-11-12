# Proof of Concept (POC) — ASAA Templates Platform

**Document status:** Requirements discovery consolidated — planning baseline; implementation status is tracked separately  
**Version:** 1.2  
**Date:** 2026-11-12  
**Owner:** ASAA platform owner  
**Repository:** https://github.com/ASAA1229/Templates

## 1. Executive summary

ASAA Templates is planned as a private, owner-controlled internal software-development and business-operations platform. Its first purpose is to help the owner build, test, integrate, deploy, monitor, maintain and deliver software products efficiently using reusable templates, components, workflows, automation and AI assistance.

This is **not initially a public template marketplace**. It is an internal company workspace and engineering operating platform. The owner is the only assumed user at the start; employees, teams, departments and other organizations are future capabilities, not current operational assumptions.

The platform should reduce repeated engineering effort, delivery time and cost while improving quality, consistency, delivery capacity and business profitability. In the future, the platform may be offered to other companies as a configurable product or service.

## 2. Problem statement

Software delivery commonly repeats setup, architecture, UI, backend, integrations, testing, deployment and operational work. Repeated work increases cost and delivery time, creates inconsistent quality and makes it harder to reuse proven solutions. Project information, engineering workflows, AI tools and business operations can also become fragmented.

The proposed platform provides one governed workspace for reusable engineering assets and end-to-end delivery workflows, with a path to broader business operations.

## 3. Product vision and outcomes

### Initial operating model
- Private repository and private-first application.
- Owner-controlled administration and approvals.
- Owner-controlled bootstrap initially; the first internal rollout is for explicitly authorized ASAA management and employees only. Do not enable employee access until invitation, role enforcement, audit and isolation controls are verified.
- Local-first and free/open-source by default.
- Strict operating-cost ceiling of **₹0 until the owner explicitly authorizes spending**.
- Architecture prepared for later teams, organizations, isolated tenants and SaaS operation.

### Intended outcomes
1. Create projects from reusable templates, combinations of templates, imports or a blank starting point.
2. Standardize architecture, development, testing, security, documentation and delivery.
3. Manage requirements, tasks, code, builds, tests, releases, deployments and operations.
4. Reuse components, design systems, integrations, workflows and engineering knowledge safely.
5. Use optional AI agents for assistance and controlled automation.
6. Maintain evidence-based product and release status; a successful build must not be treated as production readiness.
7. Extend later into CRM, sales, proposals, quotations, contracts, finance, HR, support, procurement, analytics and other business operations.
8. Productize the platform for other companies only after the internal platform is proven and separately approved.

## 4. Users and access model

| Stage | Users | Access model |
|---|---|---|
| Bootstrap | Owner only | Owner creates and governs the platform; no other account is enabled until access controls are ready |
| First internal rollout | Owner, authorized management and employees | Invitation-only accounts with least-privilege roles; no public or external-organization access |
| Later internal | Admins, employees, teams, departments | Configurable least-privilege permissions and approvals |
| Future external | Separate organizations and their users | Tenant-isolated workspaces, data, identity, configuration and administration |

The owner remains the ultimate authority for platform-wide governance. Delegated administrators receive only explicitly granted permissions. External organizations must not access another organization's data or the owner's personal JARVIS memory.

## 5. Scope

### 5.1 Initial platform foundation
- Secure owner identity, authentication, session management and recovery.
- Unified workspace, dashboard, navigation and global search.
- Project and requirements management.
- Template/catalog metadata and reusable asset foundation.
- Project initialization from template, imported source, template composition or scratch.
- Repository and source-control integration.
- Configurable technology and architecture profiles.
- Development workflow, task tracking and documentation.
- Build, test, quality-gate and release workflow foundations.
- Local-first deployment and environment configuration.
- Audit, logs, backups and owner administration.

### 5.2 Planned engineering capabilities
- Frontend, backend, database, API and integration architecture.
- Reusable UI components, design tokens, themes and responsive layouts.
- Build runners, background jobs and event-driven workflows where justified.
- Unit, integration, API, component, UI, E2E, security, performance, accessibility, compatibility and reliability testing.
- CI/CD, environment promotion, deployment verification and rollback.
- Observability: structured logs, metrics, traces, alerts and incident tracking.
- Dependency, license, secret, container, IaC and software-supply-chain controls.
- Versioning, changelogs, compatibility, impact analysis and controlled migrations.

### 5.3 Future business modules
CRM and sales; proposals and quotations; contracts; accounting and finance; payroll and HR; procurement and vendors; inventory and assets; customer support and service management; knowledge management; business-process automation; BI and reporting; legal/compliance; risk and continuity; strategic planning and partnerships. These are roadmap capabilities, not an assertion that they belong in the first MVP.

## 6. Template and project lifecycle

1. Discover or create a project.
2. Capture requirements, user stories, constraints and acceptance criteria.
3. Select a template, combine reusable assets, import an existing project or start from scratch.
4. Evaluate architecture, technology, dependencies, security and estimated effort.
5. Generate an independent project workspace/repository.
6. Develop through controlled branches, reviews and traceable tasks.
7. Build and run relevant automated/manual tests.
8. Evaluate quality, security, accessibility, performance and compatibility evidence.
9. Approve and deploy to an appropriate environment.
10. Run post-deployment checks and monitor the release.
11. Maintain documentation, versions, support, incidents and controlled updates.

Generated projects are independent artifacts. Template changes must never silently overwrite generated projects. Updates require compatibility analysis, impact visibility, explicit selection and rollback/recovery planning.

## 7. Architecture direction

### 7.1 Architectural style
- Begin with a **modular monolith** and explicit domain boundaries.
- Extract independently deployable services only when justified by security, scaling, workload, ownership or deployment needs.
- API-first contracts and event-driven communication where useful.
- Provider-independent adapters for repositories, databases, storage, CI/CD, AI and infrastructure.
- Keep template source, released template versions and generated projects distinct.
- Keep JARVIS separate from this product, connected only through a dedicated permissioned integration layer.

### 7.2 Frontend
A unified application shell with feature modules, shared design system, typed interfaces, centralized API clients, role-aware navigation, responsive layouts, accessible interactions, lazy loading and plugin-ready extension points. Micro-frontends are optional and should not be introduced prematurely.

### 7.3 Backend
Domain-oriented modules with explicit responsibilities, data ownership, API/event contracts, validation, standardized errors, background workers and auditability. Use synchronous APIs for short operations and asynchronous jobs for long-running generation, builds, tests, deployments and other workloads.

### 7.4 Data and storage
Select the initial database and storage technologies after evaluating actual workflows, transactions, query patterns, security, local deployment, portability and cost. Specify schemas, relationships, constraints, indexes, migrations, tenant boundaries, retention, audit and recovery. Keep provider adapters and migration paths documented.

### 7.5 Technology decisions
The initial frontend, language, backend, database and UI foundation are approved in Section 17 and ADR-001. Exact versions and all other supporting products (including testing, queue, CI/CD, storage, monitoring and deployment tools) remain subject to separate evaluation and ADRs. Evaluate options against security, maintainability, performance, maturity, compatibility, productivity and the ₹0 constraint.

## 8. AI and JARVIS integration

JARVIS remains a separate product with its own lifecycle. Templates may consume selected capabilities through a dedicated integration boundary:
- Conversational chatbot.
- Specialized AI agents.
- Monitoring bot.
- Model management and orchestration.
- Reusable AI modules and extensible integrations.

Do not import personal JARVIS features or expose personal memory, private data, device control or personal permissions to company users. Company agents require their own identities, scoped tools, memory, permissions, audit logs, risk classification and approval policies. Local/free models are preferred. No paid API, model, hosted service or AI usage without explicit owner approval.

AI-generated or AI-proposed changes must be validated. High-impact actions such as publishing, external communication, paid commitments, production deployment, destructive changes or credential access require policy-based approval.

## 9. UI/UX proof-of-concept expectations

- Unified enterprise workspace; desktop-first initially but fully responsive.
- Screen inventory, routes, user journeys, role access and wireframes.
- Reusable design tokens, component APIs, variants, themes and documentation.
- Loading, empty, success, validation, error, disabled, focus, hover, active and offline states.
- Keyboard support, screen-reader support and WCAG 2.2 AA target.
- Global search, contextual actions, shortcuts, notifications and customizable dashboards.
- Usability, accessibility, responsive and visual-regression validation.
- MVP screens must be fully specified; future screens may be planned at a higher level.

## 10. DevOps and deployment expectations

- Local-first, reproducible development and deployment.
- Separate development, testing, staging and production configurations; temporary preview environments when practical.
- CI/CD selected from free/local-first tools after an evaluation; GitHub Actions and Jenkins may be assessed, not assumed as final.
- Pipeline stages selected by project risk and technology: validation, build, tests, scans, packaging, artifact verification, approvals, deployment, smoke tests and rollback.
- Secrets encrypted and isolated; never committed to Git.
- Versioned artifacts, checksums, provenance and appropriate registry adapters.
- IaC and configuration-as-code where useful; drift detection and reproducible setup.
- Structured logs, metrics, traces, health checks, alerting and incident workflows.
- Backups, integrity verification, restore tests and documented RPO/RTO targets.
- No paid runner, registry, infrastructure, domain, API, hosted database or subscription without explicit approval.

## 11. Testing and quality engineering

Testing is continuous and risk-based, not a final phase only. The strategy includes:
- Unit, component, integration, API, contract, UI and E2E tests.
- Regression, exploratory, smoke and post-deployment verification.
- SAST, DAST, SCA, secret, API, container and IaC security testing.
- Penetration testing where appropriate and safely authorized.
- Load, stress, spike, endurance, concurrency and scalability tests.
- Accessibility, browser, device, OS, runtime, framework and database compatibility tests.
- Reliability, recovery, backup/restore and failure-path tests.
- Synthetic/privacy-safe test data, isolated reproducible environments and traceability.
- Centralized reports, evidence, defect severity, coverage trends and flaky-test handling.

Release states must distinguish at least: not started, in development, development complete, build verified, testing in progress, testing complete, blocked/failed and production ready. Build success alone is not a release gate.

## 12. MVP proposal and boundaries

The exact MVP must be confirmed through dependency and value analysis before coding. The recommended first usable vertical slice is:

1. Owner login and secure owner console.
2. Unified dashboard and navigation.
3. Create/manage a project and its requirements.
4. Catalog metadata and a small, validated template/asset foundation.
5. Initialize a project from a template or scratch.
6. Create or connect a Git repository and track work.
7. Run a reproducible build and relevant automated tests.
8. Record quality evidence and project status.
9. Produce project documentation and a basic release/deployment workflow.
10. Audit important actions and back up essential data.

Advanced multi-tenant SaaS, full accounting/payroll, public marketplace, autonomous production remediation, paid AI, complex distributed microservices and enterprise integrations should remain future scope unless a dependency analysis proves one is essential to the first usable release.

## 13. POC acceptance criteria

The POC planning baseline is acceptable when:
- Product purpose, users, boundaries and future direction are unambiguous.
- Owner-only and ₹0 constraints are explicit.
- The proposed MVP can be described as an end-to-end user journey.
- Architecture boundaries and integration principles are documented.
- Selected JARVIS capabilities and strict isolation are documented.
- UI/UX, DevOps, testing, security and release expectations are defined.
- Unknown technology choices are clearly marked as pending decisions, not fabricated as approved.
- User stories are traceable to acceptance criteria and test coverage.
- Development status is not overstated.

The first implemented MVP is acceptable only when its owner can create a project, initialize it, manage requirements/source, run a reproducible build and tests, inspect quality evidence, and manage a documented release workflow without violating the zero-cost or security constraints.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope becomes too broad | Dependency-based MVP, staged roadmap and explicit deferrals |
| Premature microservices/overengineering | Modular monolith first; extract only with evidence |
| Unexpected cost | ₹0 hard constraint, cost checks and owner approval |
| Vendor lock-in | Adapters, open standards, export and migration plans |
| AI overreach or data leakage | Separate identities/memory, scoped tools, approvals and audit |
| Template updates break client projects | Independent outputs, compatibility checks and explicit migrations |
| False release confidence | Evidence-based gates; build success is not production readiness |
| Insecure credentials or tenant data | Secret stores, least privilege, isolation and security testing |

## 15. Decisions still required before implementation

- Exact MVP modules, features and acceptance thresholds.
- Pinned runtime/package versions, storage details and deployment topology; the initial application stack is approved in Section 17 and ADR-001.
- Design tooling and detailed UI architecture; Tailwind CSS + shadcn/ui is approved as the initial UI foundation.
- Repository integration and Git automation approach.
- CI/CD and runner selection.
- Local execution, containers and deployment topology.
- Queue/event technology, if required by MVP workloads.
- Backup tooling and initial recovery objectives.
- Test framework/tool matrix and coverage thresholds.
- Exact data model, API contracts, screen inventory and wireframes.
- Milestones, task estimates and sequencing.

## 16. Current status

This document records the product and architecture baseline. Implementation evidence is tracked separately: parts of the platform have been implemented on branch new, but implementation, build verification, testing, integration and deployment remain distinct states. See [Project Status](PROJECT_STATUS.md) for evidence and [User Stories](USER_STORIES.md) for the requirements backlog.


## 17. Approved technology baseline — decision update (2026-11-09)

The platform owner has approved the following initial implementation stack. This decision supersedes the pending-stack statement in Section 7.5 for the technologies listed here.

| Layer | Approved technology | Implementation direction |
|---|---|---|
| Frontend | React + Vite | Single-page application; modular feature structure |
| Languages | TypeScript + JavaScript | TypeScript by default; JavaScript supported where appropriate |
| Backend | Node.js + Express | Modular-monolith API; domain-oriented modules |
| Database | PostgreSQL + Prisma | Relational data model, schema migrations and typed data access |
| UI styling/components | Tailwind CSS + shadcn/ui | Reusable accessible components and shared design tokens |

### Decision boundaries
- The approved stack is the starting baseline, not permission to add paid services or infrastructure.
- Runtime, package and framework versions must be pinned in the implementation ADR/package manifests after compatibility validation.
- Authentication/session implementation, API contracts, database schema, folder boundaries and UI architecture require detailed design before their respective implementation tasks.
- Testing libraries, CI provider, deployment platform, container strategy, queues, object storage and monitoring products are **not yet approved**. Evaluate free/local-first options and record decisions separately.
- Prefer local development and reproducible setup. Do not introduce a paid hosted database, hosted runner, registry, API or subscription without explicit owner approval.
- TypeScript is the default for new application code; JavaScript interoperability is allowed where justified.

### Initial implementation sequence
1. Record the approved stack in ADR-001 and define repository conventions.
2. Scaffold the frontend and backend as clearly separated modules within a modular monolith.
3. Establish PostgreSQL/Prisma configuration, schema/migration conventions and safe local environment handling.
4. Build the shared UI foundation and application shell.
5. Implement the first vertical slice: secure owner sign-in, owner dashboard and project creation/management.
6. Add automated validation and test infrastructure only after selecting and documenting free/local-first tools.

No item in this sequence is considered implemented merely because it is documented.

## 18. Development readiness and status rules

The technology baseline is now selected sufficiently to begin architecture and scaffolding work. Detailed API/data contracts, screen specifications, security design, test-tool selection and delivery-tool selection remain implementation prerequisites or staged design tasks. User stories remain Not Started until code is implemented and their acceptance criteria are verified. See [Project Status](PROJECT_STATUS.md), [User Stories](USER_STORIES.md) and [ADR-001](ADR-001-APPROVED-STACK.md).


## 19. Requirements discovery consolidation — 2026-11-11

The platform owner completed the first 31-question requirements discovery sequence. The answers in this section are the current product-direction baseline. They expand the earlier template-and-engineering foundation into a broader internal Business Technology Ecosystem. They do **not** mean every capability belongs in the first MVP or that any capability is already implemented.

### 19.1 Product vision and scope decisions (Q1–Q11)

1. **Product identity:** a complete Business Technology Ecosystem integrating template management, software development, digital-product engineering and internal developer-platform capabilities in a modular architecture.
2. **Stakeholders and actors:** organization administrators and management; project/product managers; developers and engineers; UI/UX designers; domain specialists; QA, security and DevOps; employees and requesters; and governed AI agents/automation.
3. **Workspace model:** a hybrid central workspace with independent modules, department workspaces, project workspaces and personal configurable dashboards.
4. **Extensibility:** modular core, optional modules/plugins, internal catalog, APIs/SDKs, event integrations, versioning, dependency management and governance.
5. **Scope progression:** technology/templates first, then projects and delivery, business operations, organization management and eventually multi-organization capability.
6. **Organization model:** adaptive hierarchy supporting parent organizations and subsidiaries, business units, divisions, departments, teams and projects; tenant isolation, shared services, cross-organization collaboration and independent governance.
7. **Operating actors:** people, automation and AI coexist. Low-risk work may be automated; sensitive/high-impact operations require human approval. AI agents are never unrestricted administrators.
8. **Lifecycle orchestration:** configurable workflows, events, approvals and tracking span templates, projects, business processes, software delivery and organizational operations.
9. **Information architecture:** module-owned data, shared platform services, federated access, central discovery, documentation/knowledge, analytics, governed AI context/memory, retention and audit.
10. **Access channels:** desktop web, responsive mobile web, PWA, native Android/iOS, tablet, APIs/machine-to-machine, desktop application, offline-first/synchronization and additional channels such as chat, CLI and internal portals.
11. **Experience model:** adaptive unified experience with role-aware navigation, configurable workspaces, command center, application launcher, global search and optional AI conversation.

### 19.2 UI/UX and design-system decisions (Q12–Q31)

The selected direction is a unified but adaptive design language: modules may use interaction patterns suited to their work while sharing centrally governed brand identity, tokens, accessibility and component contracts.

- **Design and themes (Q12–Q14):** shared design system with module-appropriate patterns; organization branding; light, dark and system themes; predefined and module themes; personal customization; accessibility presets; centrally governed tokens; role defaults; drag-and-drop widgets; saved profiles; configurable layouts, navigation, panels and shortcuts; AI recommendations; shared team dashboards and administrator policies.
- **Data interaction (Q15):** advanced tables, cards/grids, Kanban, Gantt/timelines, charts/analytics, trees/hierarchies, maps, relationship graphs, real-time monitoring and command-driven exploration.
- **Interaction behavior (Q16):** motion and micro-interactions; drag-and-drop and contextual actions; keyboard/command actions; live updates and collaboration; device-aware behavior; reduced-motion/accessibility modes; and adaptation to network/performance conditions.
- **Component engineering (Q17):** centralized tokens; modular, versioned component packages; configurable variants/slots/page schemas; design-to-code support; registry and dependency management; automated accessibility and visual-regression checks; documentation/previews; controlled releases and backward compatibility.
- **Accessibility and localization (Q18):** WCAG 2.2 AA baseline and AAA where practical; keyboard and screen-reader support; visual/sensory accessibility; reduced motion; multilingual UI/content; locale-aware dates, currency, numbers and calendars; RTL; localization-ready templates/components; automated accessibility tests.
- **Device experience (Q19):** responsive and device-specific layouts; capability-aware components; mobile-first or desktop-first according to workflow; touch, mouse, keyboard and stylus; orientation handling; offline/synchronization; consistent cross-device workflows.
- **Template discovery (Q20):** advanced catalog, search/filter, interactive and device-viewport previews, comparison, documentation, version history, ratings/evaluation, isolated demos, personalized recommendations, AI discovery and guided wizard.
- **Template customization (Q21):** visual drag-and-drop, no-code, low-code and full-code modes; live and multi-device preview; theme/design editor; component/section library; version comparison/rollback; AI customization; collaborative editing and reusable profiles.
- **Collaboration (Q22):** real-time co-editing, comments/annotations, review/approval, task assignments, activity/audit history, presence, notifications, team chat, documents/files, AI collaboration assistance, cross-module collaboration and controlled external collaboration.
- **Notifications (Q23):** central notification center; real-time, email, mobile push and in-app delivery; priority/severity; user-configurable rules; smart grouping/deduplication; AI prioritization; escalation/reminders; delivery/audit tracking; organization-wide policies.
- **Global search and command center (Q24):** universal cross-module search; advanced filters/facets; natural-language and semantic search; command palette; contextual actions; saved searches/shortcuts; recent/frequent items; relationship search; permission-aware results; search analytics/relevance tuning; approved AI multi-step action orchestration.
- **Dashboards (Q25):** role-based, personal, department/team, project/workspace, executive and operational dashboards; analytics; AI-generated dashboards; configurable widgets/layouts; sharing/permissions; scheduled snapshots/reports; live data and refresh controls.
- **Business intelligence (Q26):** standard and custom reports; interactive visualizations; drill-down; cross-module analytics; real-time and historical/trend analysis; predictive analytics; AI insights/anomaly explanations; scheduled subscriptions; export/interoperability; governance and data lineage.
- **Forms and workflows (Q27):** dynamic builder; conditional logic; multi-step forms; reusable templates; validation/data quality; autosave/draft recovery; bulk entry/import; workflow-driven forms; signatures/acknowledgments; AI-assisted entry; versioning/audit; accessibility/localization.
- **Files and assets (Q28):** centralized repository; folders/hierarchy; metadata/tags/search; preview/edit integrations; version history and comparison; collaborative editing; granular secure sharing; media/asset library; lifecycle/retention; AI OCR/classification/summarization/extraction; storage integrations/sync; integrity and security scanning.
- **Activity and audit history (Q29):** unified feeds; entity timelines; user/team activity; system/technical events; security/admin trails; before/after comparisons; filtering/correlation; real-time streams; exportable tamper-resistant evidence; AI summaries; retention/archival; cross-module event correlation.
- **Navigation and workspaces (Q30):** global navigation; organization hierarchy; workspace switcher; application launcher; context preservation; breadcrumbs; multiple tabs/saved workspaces; favorites/shortcuts; permission-aware navigation; adaptive layouts; deep links; AI-assisted navigation.
- **Onboarding and assistance (Q31):** personalized onboarding; product tours; contextual help; guided tasks; searchable knowledge center; video tutorials; role-based learning paths; AI support assistant; in-app support/issue reporting; feature/release guidance; training progress/certifications; feedback and continuous improvement.

All options offered in Q12–Q31 were selected. This records desired capability coverage, not a commitment to implement every item in one release.

## 20. Product capability domains

The requirements above are grouped into governed capability domains. Modules may be delivered independently while using shared platform services.

| Domain | Responsibility | Key shared dependencies |
|---|---|---|
| Identity, organization and governance | Users, roles, organization hierarchy, policies, tenant boundaries and approvals | Identity, authorization, audit |
| Workspace and experience shell | Navigation, dashboards, personalization, themes and accessibility | Design system, preferences, permissions |
| Template and asset ecosystem | Catalog, templates, components, profiles, previews, versions and generation | Registry, storage, metadata, provenance |
| Project and product delivery | Requirements, stories, tasks, milestones, repositories and releases | Workflow, source control, traceability |
| Engineering and DevOps | Build, test, quality gates, artifacts, deployment and operations | Runners, integrations, observability |
| Workflow and forms | Form schemas, business rules, approvals, automation and signatures | Workflow engine, policy, audit |
| Documents and knowledge | Files, media, collaboration, search, retention and knowledge | Storage, indexing, permissions |
| Collaboration and communication | Comments, presence, assignments, chat and controlled sharing | Notifications, identity, activity |
| Search and command center | Universal discovery, commands and approved task orchestration | Search index, permissions, action registry |
| Notifications and attention | Delivery, preferences, prioritization, escalation and delivery evidence | Event processing, channels, policy |
| Analytics and intelligence | Dashboards, reports, trends, forecasts and data lineage | Governed data access, metrics, scheduling |
| Activity and observability | Audit timelines, operational events, incidents and correlation | Event schema, logs, metrics, retention |
| Learning and assistance | Onboarding, tutorials, help, support and certifications | Knowledge, role model, analytics |
| Future business operations | CRM, sales, contracts, finance, HR, procurement, support and other business capabilities | Shared identity, workflow, data governance |

## 21. Cross-cutting architecture requirements

1. **Modular ownership:** each domain owns its business rules and authoritative data; shared services expose explicit contracts rather than creating uncontrolled shared-table coupling.
2. **Organization-aware authorization:** enforce permissions server-side at organization, workspace, module, resource and action levels. Search, dashboards, exports, AI context and notifications must apply the same access rules.
3. **Tenant-ready, not prematurely distributed:** model organization and workspace boundaries from the beginning, but retain the modular-monolith deployment until evidence justifies service extraction.
4. **Event foundation:** define versioned event envelopes, actor, tenant/workspace context, correlation/causation IDs, timestamps, classification, retention and idempotency. Use asynchronous processing for notifications, indexing, analytics, scheduled work and long-running jobs where justified.
5. **Workflow governance:** model workflow definitions and versions, states, transitions, conditions, approvals, assignments, timeouts, escalation and audit. High-risk transitions require policy checks and human authorization.
6. **Search and indexing:** use an index as a discovery projection, not as the authorization source of truth. Re-check access when returning results or executing commands. Support re-indexing and deletion/retention propagation.
7. **Analytics governance:** define metric ownership, semantic definitions, source lineage, freshness, aggregation limits and privacy controls. Do not silently expose sensitive cross-department or cross-tenant data.
8. **Files and collaboration:** use storage adapters, immutable/versioned metadata, malware scanning, checksums, retention and access-controlled previews. External collaboration is disabled unless explicitly approved and bounded.
9. **AI controls:** separate agent identity, memory, tools and permissions; ground answers in authorized sources; record provenance and actions; classify risk; require approval for sensitive operations; keep paid AI disabled absent authorization.
10. **Channel consistency:** web, PWA, native, desktop, CLI and API clients must use shared identity, contracts, authorization and audit. Offline changes require conflict handling, encryption and explicit synchronization rules.
11. **Design-system governance:** tokens, components, themes and schemas require versioning, compatibility policy, accessibility checks, documentation and controlled release.
12. **Operational resilience:** background work needs retries, timeouts, cancellation, idempotency, dead-letter visibility and bounded resource use. Notification delivery, scheduled jobs and integrations need observable failure states.

## 22. Experience and interaction acceptance baseline

Every user-facing capability must define, as applicable:

- Route/deep link, navigation placement, user journey, role/permission rules and responsive behavior.
- Loading, empty, populated, validation, success, error, disabled, focus, hover, offline, stale-data and permission-denied states.
- Keyboard-only operation, screen-reader semantics, visible focus, contrast, reduced motion and accessible validation.
- Localization-ready labels, date/time/currency/number formatting, time zones, calendars and RTL layout.
- Search/filter/sort/pagination behavior, URL state and context restoration where relevant.
- Data freshness, source/provenance, last-updated indicators and safe handling of partial failures.
- Audit events for sensitive changes, exports, approvals, configuration changes and administrative actions.
- Usability and performance validation on representative desktop, tablet and mobile viewports and network conditions.

The default accessibility target is WCAG 2.2 AA; AAA criteria should be adopted where practical and appropriate. Automated checks do not replace manual keyboard and assistive-technology testing.

## 23. Phased delivery interpretation

The selected capabilities are a target ecosystem, not a single-release backlog. Delivery must be dependency- and risk-based:

- **Foundation:** identity/authorization, organization/workspace model, application shell, design tokens/components, audit, project/requirements foundation, catalog foundation, API contracts and local development.
- **Core internal platform:** role-aware workspace, project delivery, template lifecycle/customization, search, notifications, document/file foundation, forms/workflows and operational visibility.
- **Advanced productivity:** collaboration, configurable dashboards, BI/reporting, onboarding/knowledge, AI-assisted discovery and governed automation.
- **Enterprise expansion:** multi-organization administration, advanced tenant isolation, native/desktop/offline clients, broad business operations and controlled external collaboration.
- **Productization:** independent security, privacy, compliance, support, billing/business model and operational-readiness assessment before any external offering.

The precise MVP boundary and story priorities remain subject to dependency analysis. The initial operating-cost limit remains ₹0 until explicit owner authorization. Existing approved React/Vite, TypeScript/JavaScript, Node.js/Express, PostgreSQL/Prisma and Tailwind/shadcn foundations remain unchanged.

## 24. Discovery traceability and status

- Q1–Q11: product vision, actors, workspace, extensibility, scope progression, organization model, human/AI governance, lifecycle, information architecture, channels and unified experience.
- Q12–Q21: design system, themes, personalization, data interaction, interaction behavior, component engineering, accessibility/localization, device experience, catalog discovery and customization.
- Q22–Q31: collaboration, notifications, search/command center, dashboards, BI, forms/workflows, documents/assets, activity/audit, navigation and onboarding/assistance.

The questionnaire was stopped after Q31 at the owner's direction. No additional discovery questions are implied by this update. Unspecified implementation details remain open decisions and must not be guessed. This document is a requirements baseline; it is not implementation, test or production evidence.


## 25. Initial implementation slice — universal search

The first implementation slice derived from Q24 is committed to the new branch:

- Authenticated API endpoint: GET /api/search?q=term.
- Searches project names, keys and purposes; requirement titles, codes and descriptions; and catalog titles, slugs and descriptions.
- Requires the existing project, requirement and catalog read permissions.
- Restricts project and requirement matches to the authenticated owner's active projects.
- Uses bounded result counts (up to five results per domain) and validates query length (2–80 characters).
- Returns only navigation-safe result fields, not full records or secrets.
- React application shell includes a debounced global search control, Escape/Enter keyboard behavior and result navigation.

This is a keyword-search foundation, not the complete Q24 target. Semantic/natural-language search, filters/facets, saved queries, search analytics, indexing, mobile command palette and AI task orchestration remain unimplemented. Search uses direct database queries at this stage; a dedicated search index is deferred until scale and query measurements justify it.

Verification: implementation and API tests are committed. The latest GitHub Actions run is being used for format, lint, typecheck, database-backed tests and build verification. Do not treat the story as complete until the run passes.


## 26. Objective gap analysis and delivery priorities — 2026-11-12

A comparison of the agreed product objective with the current new branch implementation identified a substantial gap between the existing owner-first template/project foundation and the intended reusable software-development ecosystem.

### 26.1 Current implementation boundary

The current source tree contains:
- Owner-only authentication/session handling and permission checks.
- Project and requirement management, audit events, dashboard and keyword/advanced search.
- A private catalog metadata API and a local manifest-driven template library.
- A generation flow with template approval, preview, output generation, provenance and integrity verification.
- A project workspace with local Git operations, branch policy and environment metadata.
- 25 initial website demo packages across five business types.
- Repository CI and automated API/UI/browser test foundations.

These are meaningful foundations, but they do not establish the complete product objective. In particular, the current generator schema primarily describes files, inputs, dependencies and compatibility; the current demo batch is website-oriented. The current identity model is a single owner. The current workspace is not a full online IDE. The repository CI workflow is not, by itself, a product-level build/test orchestration service for arbitrary generated projects.

### 26.2 Material gaps

1. **Template certification:** all 25 packages still require actual loader, approval, preview, generation, output-integrity and browser/responsive validation before they can be called certified.
2. **Multi-stack generation:** the generator needs project-family blueprints and adapters for complete applications, APIs, backend services and other technology families; static website files are not sufficient.
3. **Template authoring:** a governed in-platform workflow is needed to create/import/edit, validate, package, version, review and release templates.
4. **Configuration and preview:** guided, low-code and advanced configuration, visual customization and responsive previews are not yet a complete workflow.
5. **Safe execution:** project builds and tests need isolated runners, resource limits, cancellation, logs and evidence; arbitrary code must not execute in the trusted API process.
6. **Project delivery:** complete ZIP export and approved remote repository provisioning/push are required for independent project hand-off.
7. **Internal identity:** the current single-owner data/auth model must evolve to invitation-only management and employee accounts with server-enforced least-privilege roles before internal rollout. The owner remains the ultimate authority.
8. **Reusable composition:** a governed component, design-system, asset and integration registry plus dependency-aware composition is needed.
9. **Development workspace:** source browsing/editing and safe hand-off to local/online development tools need to extend beyond the current Git/environment panel.
10. **End-to-end operations:** product-level CI/CD, release approvals, environment promotion, deployment verification, observability, incidents and tested backup/restore remain incomplete.
11. **Coverage expansion:** the sector/division registry is not a populated library. New templates must follow demand and project-family priorities with certification evidence.

### 26.3 First implementation priority

The first execution sequence is recorded in [User Stories](USER_STORIES.md), Epic X (US-X01–US-X12). The immediate work is to stabilize current CI and certify all 25 initial packages, then generalize project blueprints/generation, add governed template authoring and project configuration, and build isolated execution and delivery workflows. Internal employee/management access follows only after its security and audit gates are verified.

The ₹0 operating-cost limit, private/internal access boundary, owner governance, separate JARVIS identity/memory, independent generated projects and no automatic production/client publishing remain mandatory constraints.

